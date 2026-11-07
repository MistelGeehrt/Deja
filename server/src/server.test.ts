import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, splitPrice, type Config } from "./server.js";
import { fingerprint, normalizeTask } from "./fingerprint.js";
import { checkParsedTx } from "./solana.js";
import { PublicKey } from "@solana/web3.js";

const cfg: Config = {
  port: 0,
  dbPath: ":memory:",
  priceMicroUsdc: 100_000,
  feeBps: 500,
  platformWallet: "PLATFORM",
  usdcMint: "USDC",
  rpcUrl: "",
  cluster: "test",
  publicUrl: "http://test",
  seedMaxPerRun: 5,
  dashboardKey: "",
  freePerDay: 2,
  skipChainVerify: true,
};

describe("empreinte", () => {
  it("ignore casse, accents et ponctuation", () => {
    expect(normalizeTask("Résume-moi CETTE page !")).toBe("resume moi cette page");
  });
  it("ignore les paramètres de suivi de l'URL", () => {
    const a = fingerprint("résume", "https://x.com/p?utm_source=a", "texte");
    const b = fingerprint("Résumé", "https://x.com/p", "texte");
    expect(a).toBe(b);
  });
  it("change si la page change", () => {
    expect(fingerprint("résume", "https://x.com", "A")).not.toBe(fingerprint("résume", "https://x.com", "B"));
  });
});

describe("partage du prix", () => {
  it("5 % de commission sur 0,10 USDC", () => {
    expect(splitPrice(100_000, 500)).toEqual({ fee: 5_000, sellerAmount: 95_000 });
  });
});

describe("bourse", () => {
  let calls = 0;
  const app = buildApp(cfg, { agent: async (t) => (calls++, "réponse à : " + t) });
  beforeAll(() => app.ready());
  afterAll(() => app.close());

  const body = { task: "Résume cette page", url: "https://ex.com", pageText: "bla" };

  it("premier passage : l'agent travaille, le résultat est mis en vente", async () => {
    const r = await app.inject({ method: "POST", url: "/solve", payload: { ...body, wallet: "ALICE" } });
    expect(r.json().status).toBe("created");
    expect(calls).toBe(1);
  });

  it("le créateur relit gratuitement", async () => {
    const r = await app.inject({ method: "POST", url: "/solve", payload: { ...body, wallet: "ALICE" } });
    expect(r.json().status).toBe("owned");
    expect(calls).toBe(1);
  });

  it("un autre wallet reçoit un devis au lieu de refaire le travail", async () => {
    const r = await app.inject({ method: "POST", url: "/solve", payload: { ...body, wallet: "BOB" } });
    const j = r.json();
    expect(j.status).toBe("quote");
    expect(j.seller_wallet).toBe("ALICE");
    expect(j.seller_amount_micro_usdc).toBe(95_000);
    expect(j.fee_micro_usdc).toBe(5_000);
    expect(calls).toBe(1);
  });

  it("après paiement, Bob reçoit le résultat et la vente est comptée", async () => {
    const fp = fingerprint(body.task, body.url, body.pageText);
    const r = await app.inject({ method: "POST", url: "/buy", payload: { fingerprint: fp, signature: "SIG1", wallet: "BOB" } });
    expect(r.json()).toMatchObject({ status: "purchased", result: "réponse à : Résume cette page" });
    const again = await app.inject({ method: "POST", url: "/buy", payload: { fingerprint: fp, signature: "SIG1", wallet: "BOB" } });
    expect(again.statusCode).toBe(409);
    const own = await app.inject({ method: "POST", url: "/solve", payload: { ...body, wallet: "BOB" } });
    expect(own.json().status).toBe("owned");
  });

  it("les statistiques donnent le taux de doublon", async () => {
    const s = (await app.inject({ method: "GET", url: "/stats" })).json();
    expect(s.misses).toBe(1);
    expect(s.hits).toBe(3);
    expect(s.sales).toBe(1);
    expect(s.duplicate_rate).toBeCloseTo(0.75);
    expect(s.top_sellers[0]).toMatchObject({ seller_wallet: "ALICE", earned: 95_000 });
  });
});

describe("vérification d'une transaction Solana (hors ligne)", () => {
  const buyer = new PublicKey("11111111111111111111111111111112");
  const fakeTx = (opts: { sellerDelta: number; feeDelta: number; memo: string; err?: unknown }) =>
    ({
      meta: {
        err: opts.err ?? null,
        preTokenBalances: [
          { accountIndex: 1, mint: "USDC", owner: "SELLER", uiTokenAmount: { amount: "1000", decimals: 6, uiAmount: 0 } },
          { accountIndex: 2, mint: "USDC", owner: "PLATFORM", uiTokenAmount: { amount: "0", decimals: 6, uiAmount: 0 } },
        ],
        postTokenBalances: [
          { accountIndex: 1, mint: "USDC", owner: "SELLER", uiTokenAmount: { amount: String(1000 + opts.sellerDelta), decimals: 6, uiAmount: 0 } },
          { accountIndex: 2, mint: "USDC", owner: "PLATFORM", uiTokenAmount: { amount: String(opts.feeDelta), decimals: 6, uiAmount: 0 } },
        ],
      },
      transaction: {
        message: {
          accountKeys: [{ pubkey: buyer, signer: true, writable: true }],
          instructions: [{ program: "spl-memo", programId: buyer, parsed: opts.memo }],
        },
      },
    }) as any;
  const chain = { rpcUrl: "", usdcMint: "USDC", platformWallet: "PLATFORM" };
  const req = { signature: "s", buyerWallet: buyer.toBase58(), sellerWallet: "SELLER", sellerAmount: 95_000, feeAmount: 5_000, memo: "FP" };

  it("accepte une transaction correcte", () => {
    expect(checkParsedTx(fakeTx({ sellerDelta: 95_000, feeDelta: 5_000, memo: "deja:FP" }), chain, req)).toEqual({ ok: true });
  });
  it("refuse si le vendeur est sous-payé", () => {
    expect(checkParsedTx(fakeTx({ sellerDelta: 1, feeDelta: 5_000, memo: "FP" }), chain, req).ok).toBe(false);
  });
  it("refuse si la commission manque", () => {
    expect(checkParsedTx(fakeTx({ sellerDelta: 95_000, feeDelta: 0, memo: "FP" }), chain, req).ok).toBe(false);
  });
  it("refuse si la preuve ne correspond pas", () => {
    expect(checkParsedTx(fakeTx({ sellerDelta: 95_000, feeDelta: 5_000, memo: "autre" }), chain, req).ok).toBe(false);
  });
});
