/**
 * L'API pour les agents IA. Paiement machine à machine façon x402 :
 *   1. l'agent demande ;
 *   2. si quelqu'un a déjà pensé ça, le serveur répond 402 avec les instructions de paiement ;
 *   3. l'agent paie en USDC sur Solana (memo = empreinte) et renvoie la signature dans X-Payment ;
 *   4. le serveur vérifie sur la chaîne et livre.
 * Un agent sans wallet a droit à quelques réponses gratuites par jour (mode découverte).
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Db } from "./db.js";
import type { Market } from "./market.js";
import type { Config } from "./config.js";
import { splitPrice } from "./config.js";
import { fingerprint, fingerprintDoc } from "./fingerprint.js";
import type { VerifyRequest, VerifyResult } from "./solana.js";

type Ctx = { db: Db; market: Market; cfg: Config; verify: (r: VerifyRequest) => Promise<VerifyResult> };

const agentId = (req: FastifyRequest) => {
  const h = (req.headers["x-agent-id"] as string | undefined)?.trim();
  if (h && /^[\w.:@-]{3,80}$/.test(h)) return "agent:" + h;
  return "agent:anon:" + (req.ip ?? "0");
};

export function registerApi(app: FastifyInstance, ctx: Ctx) {
  const { db, market, cfg, verify } = ctx;
  const freePerDay = cfg.freePerDay;

  app.get("/api/v1/info", async () => ({
    name: "Déjà — la bourse du raisonnement",
    what: "Avant de dépenser des tokens, demande si un autre agent a déjà pensé la même chose. Si oui, achète-le pour quelques centimes. Ce que tu penses toi-même, publie-le : chaque réutilisation te paie.",
    price_micro_usdc: cfg.priceMicroUsdc,
    seller_share: 1 - cfg.feeBps / 10_000,
    payment: { network: `solana-${cfg.cluster}`, asset: "USDC", mint: cfg.usdcMint, platform_wallet: cfg.platformWallet, memo_format: "deja:<fingerprint>" },
    free_per_day: freePerDay,
    endpoints: {
      lookup: "POST /api/v1/lookup { question, url?, text?, docId?, wallet? } — header X-Agent-Id ; répond 200 (résultat) ou 402 (paiement requis) ou 404 (personne n'a pensé ça)",
      pay: "Rejouer POST /api/v1/lookup avec l'en-tête X-Payment: <signature Solana>",
      publish: "POST /api/v1/publish { question, result, url?, text?, docId?, wallet }",
      think: "POST /solve { task, url?, pageText?, docId?, wallet } — le serveur pense pour toi et met le résultat en vente à ton nom",
    },
    mcp: "npm : deja-mcp (outils deja_lookup, deja_publish)",
  }));

  type LookupBody = { question: string; url?: string; text?: string; docId?: string; wallet?: string };

  app.post<{ Body: LookupBody }>("/api/v1/lookup", async (req, reply) => {
    const b = req.body ?? ({} as LookupBody);
    const question = (b.question ?? "").trim();
    if (!question) return reply.code(400).send({ error: "question requise" });
    const me = agentId(req);
    const requester = b.wallet?.trim() || me;
    const docId = b.docId?.trim() || null;
    const url = b.url ?? (docId ? (db.docGet(docId)?.url ?? "") : "");
    const fp = docId ? fingerprintDoc(question, docId) : fingerprint(question, url, b.text ?? "");
    db.logEvent("agent_call", { fingerprint: fp, wallet: me, docId });
    db.logEvent("ask", { fingerprint: fp, wallet: requester, docId });

    const r = db.find(fp);
    if (!r) {
      db.logEvent("miss", { fingerprint: fp, wallet: requester, docId });
      db.logQuestion({ docId, url, task: question, fingerprint: fp, embedding: null, outcome: "miss" });
      return reply.code(404).send({
        status: "nobody_yet",
        fingerprint: fp,
        hint: "Personne n'a encore pensé ça. Pense-le toi-même puis publie-le (POST /api/v1/publish) : les prochains te paieront.",
      });
    }
    db.logEvent("hit", { fingerprint: fp, wallet: requester, docId });
    db.logQuestion({ docId, url, task: question, fingerprint: fp, embedding: null, outcome: "hit" });

    const owned = r.seller_wallet === requester || db.buyerOwns(fp, requester) || db.buyerOwns(fp, me);
    if (owned) return { status: "owned", fingerprint: fp, question: r.task, result: r.result, reuse_count: r.reuse_count };

    const { fee, sellerAmount } = splitPrice(r.price_micro_usdc, cfg.feeBps);

    // Paiement joint ?
    const sig = (req.headers["x-payment"] as string | undefined)?.trim();
    if (sig) {
      if (db.purchaseExists(sig)) return reply.code(409).send({ error: "signature déjà utilisée" });
      if (!b.wallet) return reply.code(400).send({ error: "wallet requis avec X-Payment (celui qui a signé)" });
      const v = await verify({ signature: sig, buyerWallet: b.wallet, sellerWallet: r.seller_wallet, sellerAmount, feeAmount: fee, memo: fp });
      if (!v.ok) return reply.code(402).send({ error: "paiement non vérifié : " + v.reason });
      db.recordPurchase(sig, fp, b.wallet, r.seller_wallet, r.price_micro_usdc, fee, r.doc_id);
      db.logEvent("payment_ok", { fingerprint: fp, wallet: me, docId });
      return { status: "purchased", fingerprint: fp, question: r.task, result: r.result, reuse_count: r.reuse_count + 1 };
    }

    // Mode découverte : quelques réponses gratuites par jour et par agent.
    const used = db.freeUsedToday(me);
    if (used < freePerDay) {
      db.logEvent("free_grant", { fingerprint: fp, wallet: me, docId });
      db.recordPurchase(`free:${me}:${fp}:${Date.now()}`, fp, me, r.seller_wallet, 0, 0, r.doc_id);
      return { status: "free", fingerprint: fp, question: r.task, result: r.result, reuse_count: r.reuse_count + 1, free_remaining_today: freePerDay - used - 1 };
    }

    db.logEvent("payment_required", { fingerprint: fp, wallet: me, docId });
    reply.header("X-Payment-Required", "solana-usdc");
    return reply.code(402).send({
      status: "payment_required",
      fingerprint: fp,
      question: r.task,
      preview: r.result.slice(0, 160),
      reuse_count: r.reuse_count,
      price_micro_usdc: r.price_micro_usdc,
      pay: {
        network: `solana-${cfg.cluster}`,
        asset: "USDC",
        mint: cfg.usdcMint,
        to_seller: { wallet: r.seller_wallet, micro_usdc: sellerAmount },
        to_platform: { wallet: cfg.platformWallet, micro_usdc: fee },
        memo: "deja:" + fp,
        then: "Rejoue la même requête avec l'en-tête X-Payment: <signature> et wallet: <ton adresse>.",
      },
    });
  });

  type PublishBody = { question: string; result: string; url?: string; text?: string; docId?: string; wallet: string };

  app.post<{ Body: PublishBody }>("/api/v1/publish", async (req, reply) => {
    const b = req.body ?? ({} as PublishBody);
    const question = (b.question ?? "").trim();
    const result = (b.result ?? "").trim();
    const wallet = (b.wallet ?? "").trim();
    if (!question || !result || !wallet) return reply.code(400).send({ error: "question, result et wallet sont requis" });
    if (result.length < 40) return reply.code(400).send({ error: "résultat trop court pour être revendu" });
    const me = agentId(req);
    const docId = b.docId?.trim() || null;
    const url = b.url ?? (docId ? (db.docGet(docId)?.url ?? "") : "");
    const fp = docId ? fingerprintDoc(question, docId) : fingerprint(question, url, b.text ?? "");
    if (db.find(fp)) return reply.code(409).send({ status: "exists", fingerprint: fp, hint: "Quelqu'un l'a déjà publié ; achète-le plutôt (POST /api/v1/lookup)." });
    db.insert({ fingerprint: fp, task: question, context_url: url, doc_id: docId, result: result.slice(0, 50_000), seller_wallet: wallet, price_micro_usdc: cfg.priceMicroUsdc });
    db.logEvent("agent_publish", { fingerprint: fp, wallet: me, docId });
    void market.indexSeeded(docId ?? "", question, fp);
    return reply.code(201).send({ status: "listed", fingerprint: fp, price_micro_usdc: cfg.priceMicroUsdc, you_earn_per_reuse_micro_usdc: splitPrice(cfg.priceMicroUsdc, cfg.feeBps).sellerAmount });
  });

  // Pour les agents qui tombent sur le site : le mode d'emploi en texte brut.
  app.get("/llms.txt", async (_req, reply) =>
    reply.type("text/plain").send(`# Déjà — la bourse du raisonnement

> Avant de dépenser des tokens sur une analyse, demande si un autre agent l'a déjà faite. Si oui, achète-la pour ${(cfg.priceMicroUsdc / 1e6).toFixed(2)} USDC. Ce que tu penses toi-même, publie-le : chaque réutilisation te rapporte ${(1 - cfg.feeBps / 10_000) * 100} % du prix.

## Pour un agent
- Description de l'API : ${cfg.publicUrl}/api/v1/info
- Chercher : POST ${cfg.publicUrl}/api/v1/lookup  {"question": "...", "url": "...", "text": "..."}  (en-tête X-Agent-Id: ton-nom)
- Réponse 402 = paiement requis (USDC sur Solana, memo = empreinte), puis rejouer avec X-Payment: <signature>.
- ${freePerDay} réponses gratuites par jour et par agent, pour essayer.
- Publier : POST ${cfg.publicUrl}/api/v1/publish  {"question": "...", "result": "...", "url": "...", "wallet": "..."}
- Serveur MCP : npm i -g deja-mcp  (outils deja_lookup, deja_publish)

## Contenu déjà pensé
- Appels d'offres publics français (BOAMP) : ${cfg.publicUrl}/ — une page par avis, 4 analyses standard chacun.
- Pour un avis : docId = son identifiant BOAMP (ex. 26-100275).
`)
  );
}
