import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import { openDb } from "./db.js";
import { makeAgent, type Agent } from "./agent.js";
import { makeVerifier, type VerifyRequest, type VerifyResult } from "./solana.js";
import { configFromEnv, splitPrice, type Config } from "./config.js";
import { makeEmbedder, type Embedder } from "./embeddings.js";
import { Market } from "./market.js";
import { registerWeb } from "./web.js";
import { registerApi } from "./api.js";

export { configFromEnv, splitPrice, type Config };

type Deps = { agent?: Agent; verify?: (r: VerifyRequest) => Promise<VerifyResult>; embed?: Embedder };

export function buildApp(cfg: Config, deps: Deps = {}) {
  const app = Fastify({ logger: cfg.skipChainVerify ? false : true });
  app.register(cors, { origin: true });
  app.register(formbody);
  const db = openDb(cfg.dbPath);
  const agent = deps.agent ?? makeAgent({ anthropicApiKey: cfg.anthropicApiKey, openaiApiKey: cfg.openaiApiKey, model: cfg.model });
  const embed = deps.embed !== undefined ? deps.embed : makeEmbedder(cfg.openaiApiKey);
  const market = new Market(db, agent, cfg, embed);
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

  type SolveBody = { task: string; url?: string; pageText?: string; docId?: string; wallet: string };

  /** API de l'extension : cherche d'abord sur la bourse ; sinon produit et met en vente. */
  app.post<{ Body: SolveBody }>("/solve", async (req, reply) => {
    const { task, url, pageText, docId, wallet } = req.body ?? ({} as SolveBody);
    if (!task?.trim() || !wallet) return reply.code(400).send({ error: "task et wallet sont requis" });
    return market.solve({ task: task.trim(), url, pageText, docId, requester: wallet });
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

    db.recordPurchase(signature, fp, wallet, r.seller_wallet, r.price_micro_usdc, fee, r.doc_id);
    return { status: "purchased", fingerprint: fp, result: r.result };
  });

  app.get("/stats", async () => db.stats());

  registerApi(app, { db, market, cfg, verify });
  registerWeb(app, { db, market, cfg });

  return app;
}

// Lancement direct : `npm run dev` ou `npm start`
if (process.argv[1] && /server\.(ts|js)$/.test(process.argv[1])) {
  const cfg = configFromEnv();
  if (!cfg.platformWallet) console.warn("DEJA_PLATFORM_WALLET est vide : aucune commission ne sera vérifiée.");
  buildApp(cfg).listen({ port: cfg.port, host: "0.0.0.0" }).then(() => console.log(`Déjà écoute sur http://localhost:${cfg.port}`));
}
