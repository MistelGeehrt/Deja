import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { openDb } from "./db.js";
import { fingerprint } from "./fingerprint.js";
import { makeAgent, type Agent } from "./agent.js";
import { makeVerifier, type VerifyRequest, type VerifyResult } from "./solana.js";

export type Config = {
  port: number;
  dbPath: string;
  priceMicroUsdc: number;
  feeBps: number;
  platformWallet: string;
  usdcMint: string;
  rpcUrl: string;
  cluster: string;
  model?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  skipChainVerify: boolean;
};

export function configFromEnv(): Config {
  const e = process.env;
  return {
    port: Number(e.PORT ?? 8787),
    dbPath: e.DEJA_DB ?? "./deja.sqlite",
    priceMicroUsdc: Number(e.DEJA_PRICE_MICRO_USDC ?? 100_000), // 0,10 USDC
    feeBps: Number(e.DEJA_FEE_BPS ?? 500), // 5 %
    platformWallet: e.DEJA_PLATFORM_WALLET ?? "",
    // USDC officiel de Circle sur devnet
    usdcMint: e.DEJA_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    rpcUrl: e.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    cluster: e.SOLANA_CLUSTER ?? "devnet",
    model: e.DEJA_MODEL || undefined,
    anthropicApiKey: e.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: e.OPENAI_API_KEY || undefined,
    skipChainVerify: e.DEJA_SKIP_CHAIN_VERIFY === "1",
  };
}

export function splitPrice(price: number, feeBps: number) {
  const fee = Math.floor((price * feeBps) / 10_000);
  return { fee, sellerAmount: price - fee };
}

type Deps = { agent?: Agent; verify?: (r: VerifyRequest) => Promise<VerifyResult> };

export function buildApp(cfg: Config, deps: Deps = {}) {
  const app = Fastify({ logger: cfg.skipChainVerify ? false : true });
  app.register(cors, { origin: true });
  const db = openDb(cfg.dbPath);
  const agent = deps.agent ?? makeAgent({ anthropicApiKey: cfg.anthropicApiKey, openaiApiKey: cfg.openaiApiKey, model: cfg.model });
  const verify =
    deps.verify ??
    (cfg.skipChainVerify
      ? async () => ({ ok: true as const })
      : makeVerifier({ rpcUrl: cfg.rpcUrl, usdcMint: cfg.usdcMint, platformWallet: cfg.platformWallet }));

  app.get("/health", async () => ({ ok: true }));

  app.get("/config", async () => ({
    cluster: cfg.cluster,
    rpcUrl: cfg.rpcUrl,
    usdcMint: cfg.usdcMint,
    platformWallet: cfg.platformWallet,
    priceMicroUsdc: cfg.priceMicroUsdc,
    feeBps: cfg.feeBps,
  }));

  type SolveBody = { task: string; url?: string; pageText?: string; wallet: string };

  /** Cherche d'abord sur la bourse ; sinon produit le raisonnement et le met en vente. */
  app.post<{ Body: SolveBody }>("/solve", async (req, reply) => {
    const { task, url = "", pageText = "", wallet } = req.body ?? ({} as SolveBody);
    if (!task?.trim() || !wallet) return reply.code(400).send({ error: "task et wallet sont requis" });

    const fp = fingerprint(task, url, pageText);
    const existing = db.find(fp);

    if (existing) {
      db.logEvent(fp, "hit", wallet);
      const own = existing.seller_wallet === wallet || db.buyerOwns(fp, wallet);
      if (own) return { status: "owned", fingerprint: fp, result: existing.result, reuse_count: existing.reuse_count };
      const { fee, sellerAmount } = splitPrice(existing.price_micro_usdc, cfg.feeBps);
      return {
        status: "quote",
        fingerprint: fp,
        price_micro_usdc: existing.price_micro_usdc,
        seller_wallet: existing.seller_wallet,
        seller_amount_micro_usdc: sellerAmount,
        fee_micro_usdc: fee,
        platform_wallet: cfg.platformWallet,
        reuse_count: existing.reuse_count,
        preview: existing.result.slice(0, 160),
      };
    }

    db.logEvent(fp, "miss", wallet);
    const result = await agent(task, url, pageText);
    try {
      db.insert({ fingerprint: fp, task, context_url: url, result, seller_wallet: wallet, price_micro_usdc: cfg.priceMicroUsdc });
    } catch {
      /* course : quelqu'un l'a inséré entre-temps, on renvoie quand même notre résultat */
    }
    return { status: "created", fingerprint: fp, result, price_micro_usdc: cfg.priceMicroUsdc };
  });

  type BuyBody = { fingerprint: string; signature: string; wallet: string };

  /** L'acheteur a payé sur Solana : on vérifie la transaction puis on livre le résultat. */
  app.post<{ Body: BuyBody }>("/buy", async (req, reply) => {
    const { fingerprint: fp, signature, wallet } = req.body ?? ({} as BuyBody);
    if (!fp || !signature || !wallet) return reply.code(400).send({ error: "fingerprint, signature et wallet sont requis" });
    const r = db.find(fp);
    if (!r) return reply.code(404).send({ error: "raisonnement inconnu" });
    if (db.purchaseExists(signature)) return reply.code(409).send({ error: "transaction déjà utilisée" });

    const { fee, sellerAmount } = splitPrice(r.price_micro_usdc, cfg.feeBps);
    const v = await verify({ signature, buyerWallet: wallet, sellerWallet: r.seller_wallet, sellerAmount, feeAmount: fee, memo: fp });
    if (!v.ok) return reply.code(402).send({ error: "paiement non vérifié : " + v.reason });

    db.recordPurchase(signature, fp, wallet, r.seller_wallet, r.price_micro_usdc, fee);
    return { status: "purchased", fingerprint: fp, result: r.result };
  });

  app.get("/stats", async () => db.stats());

  return app;
}

// Lancement direct : `npm run dev` ou `npm start`
if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  const cfg = configFromEnv();
  if (!cfg.platformWallet) console.warn("DEJA_PLATFORM_WALLET est vide : aucune commission ne sera vérifiée.");
  buildApp(cfg).listen({ port: cfg.port, host: "0.0.0.0" }).then(() => console.log(`Déjà écoute sur http://localhost:${cfg.port}`));
}
