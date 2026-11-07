/**
 * Le cœur de la bourse, partagé par l'API (extension) et le site public.
 */
import type { Db, Reasoning } from "./db.js";
import type { Agent } from "./agent.js";
import { fingerprint, fingerprintDoc } from "./fingerprint.js";
import { cosine, NEAR_THRESHOLD, type Embedder } from "./embeddings.js";
import { splitPrice, type Config } from "./config.js";

export type SolveInput = {
  task: string;
  /** Soit une page lue par l'extension… */
  url?: string;
  pageText?: string;
  /** …soit un document connu du serveur (avis BOAMP). */
  docId?: string;
  /** Wallet (extension) ou identifiant anonyme de visiteur (site). */
  requester: string;
};

export type SolveOutput =
  | { status: "owned"; fingerprint: string; result: string; reuse_count: number; task: string }
  | {
      status: "quote";
      fingerprint: string;
      price_micro_usdc: number;
      seller_wallet: string;
      seller_amount_micro_usdc: number;
      fee_micro_usdc: number;
      platform_wallet: string;
      reuse_count: number;
      preview: string;
      task: string;
      /** Vrai si la correspondance est par le sens (quasi-doublon), pas par l'empreinte exacte. */
      near?: boolean;
    }
  | { status: "created"; fingerprint: string; result: string; price_micro_usdc: number; task: string };

export class Market {
  constructor(
    private db: Db,
    private agent: Agent,
    private cfg: Config,
    private embed: Embedder
  ) {}

  quoteFor(r: Reasoning, near = false): SolveOutput {
    const { fee, sellerAmount } = splitPrice(r.price_micro_usdc, this.cfg.feeBps);
    return {
      status: "quote",
      fingerprint: r.fingerprint,
      price_micro_usdc: r.price_micro_usdc,
      seller_wallet: r.seller_wallet,
      seller_amount_micro_usdc: sellerAmount,
      fee_micro_usdc: fee,
      platform_wallet: this.cfg.platformWallet,
      reuse_count: r.reuse_count,
      preview: r.result.slice(0, 160),
      task: r.task,
      near,
    };
  }

  /** Cherche d'abord sur la bourse ; sinon produit le raisonnement et le met en vente. */
  async solve(input: SolveInput): Promise<SolveOutput> {
    const { task, requester } = input;
    const docId = input.docId ?? null;
    const url = input.url ?? (docId ? (this.db.docGet(docId)?.url ?? "") : "");
    const fp = docId ? fingerprintDoc(task, docId) : fingerprint(task, url, input.pageText ?? "");
    const db = this.db;
    db.logEvent("ask", { fingerprint: fp, wallet: requester, docId });

    let embedding: number[] | null = null;
    if (this.embed) {
      try {
        embedding = await this.embed(task);
      } catch {
        /* sans embedding : on fait sans */
      }
    }

    const existing = db.find(fp);
    if (existing) {
      const own = existing.seller_wallet === requester || db.buyerOwns(fp, requester);
      db.logEvent("hit", { fingerprint: fp, wallet: requester, docId });
      db.logQuestion({ docId, url, task, fingerprint: fp, embedding, outcome: own ? "owned" : "hit" });
      if (own) return { status: "owned", fingerprint: fp, result: existing.result, reuse_count: existing.reuse_count, task };
      return this.quoteFor(existing);
    }

    // Quasi-doublon : même document, question au sens très proche d'une question déjà résolue.
    if (embedding && docId) {
      let best: { fp: string; score: number } | null = null;
      for (const q of db.questionsByDoc(docId)) {
        const score = cosine(embedding, q.embedding);
        if (score >= NEAR_THRESHOLD && (!best || score > best.score)) best = { fp: q.fingerprint, score };
      }
      const nearR = best ? db.find(best.fp) : null;
      if (nearR) {
        db.logEvent("near_hit", { fingerprint: nearR.fingerprint, wallet: requester, docId });
        db.logQuestion({ docId, url, task, fingerprint: fp, embedding, outcome: "near_hit" });
        const own = nearR.seller_wallet === requester || db.buyerOwns(nearR.fingerprint, requester);
        if (own) return { status: "owned", fingerprint: nearR.fingerprint, result: nearR.result, reuse_count: nearR.reuse_count, task: nearR.task };
        return this.quoteFor(nearR, true);
      }
    }

    db.logEvent("miss", { fingerprint: fp, wallet: requester, docId });
    const pageText = input.pageText ?? (docId ? (db.docGet(docId)?.text ?? "") : "");
    const result = await this.agent(task, url, pageText);
    try {
      db.insert({ fingerprint: fp, task, context_url: url, doc_id: docId, result, seller_wallet: requester, price_micro_usdc: this.cfg.priceMicroUsdc });
    } catch {
      /* course : inséré entre-temps par quelqu'un d'autre */
    }
    db.logQuestion({ docId, url, task, fingerprint: fp, embedding, outcome: "miss" });
    return { status: "created", fingerprint: fp, result, price_micro_usdc: this.cfg.priceMicroUsdc, task };
  }

  /** Enregistre une question standard déjà produite (semeur) pour que les quasi-doublons la trouvent. */
  async indexSeeded(docId: string, task: string, fp: string) {
    if (!this.embed || this.db.embeddingByFp(fp)) return;
    try {
      const embedding = await this.embed(task);
      this.db.logQuestion({ docId, url: "", task, fingerprint: fp, embedding, outcome: "owned" });
    } catch {
      /* ignoré */
    }
  }
}
