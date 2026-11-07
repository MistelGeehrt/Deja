import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, type Config } from "./server.js";

const cfg: Config = {
  port: 0,
  dbPath: ":memory:",
  priceMicroUsdc: 100_000,
  feeBps: 500,
  platformWallet: "PLATFORM",
  usdcMint: "USDC",
  rpcUrl: "",
  cluster: "devnet",
  skipChainVerify: false,
  publicUrl: "http://test",
  seedMaxPerRun: 5,
  dashboardKey: "",
  freePerDay: 1,
};

describe("API agents", () => {
  const verified: string[] = [];
  const app = buildApp(cfg, {
    agent: async () => "jamais appelé",
    verify: async (r) => (r.signature.startsWith("GOOD") ? (verified.push(r.signature), { ok: true }) : { ok: false, reason: "faux" }),
  });
  beforeAll(() => app.ready());
  afterAll(() => app.close());

  const json = async (method: "GET" | "POST", url: string, payload?: object, headers: Record<string, string> = {}) =>
    app.inject({ method, url, payload: payload as Record<string, unknown> | undefined, headers: { "content-type": "application/json", ...headers } });

  const q = { question: "Quelles sont les pièces à fournir ?", url: "https://www.boamp.fr/pages/avis/?q=idweb:26-1", text: "avis…" };
  const A = { "x-agent-id": "agent-alpha" };
  const B = { "x-agent-id": "agent-beta" };

  it("info et llms.txt décrivent le marché", async () => {
    const i = await json("GET", "/api/v1/info");
    expect(i.json().price_micro_usdc).toBe(100_000);
    const l = await app.inject({ method: "GET", url: "/llms.txt" });
    expect(l.body).toContain("POST http://test/api/v1/lookup");
  });

  it("personne n'a pensé ça : 404 avec invitation à publier", async () => {
    const r = await json("POST", "/api/v1/lookup", q, A);
    expect(r.statusCode).toBe(404);
    expect(r.json().status).toBe("nobody_yet");
  });

  it("l'agent A publie son raisonnement", async () => {
    const r = await json("POST", "/api/v1/publish", { ...q, result: "Pièces : DC1, DC2, attestations fiscales et sociales, références de moins de 3 ans.", wallet: "WALLET_A" }, A);
    expect(r.statusCode).toBe(201);
    expect(r.json().you_earn_per_reuse_micro_usdc).toBe(95_000);
    const again = await json("POST", "/api/v1/publish", { ...q, result: "x".repeat(50), wallet: "WALLET_A" }, A);
    expect(again.statusCode).toBe(409);
  });

  it("A relit gratuitement ce qu'il a publié", async () => {
    const r = await json("POST", "/api/v1/lookup", { ...q, wallet: "WALLET_A" }, A);
    expect(r.json().status).toBe("owned");
  });

  it("B : première réponse gratuite (découverte), la seconde exige un paiement (402)", async () => {
    const free = await json("POST", "/api/v1/lookup", q, B);
    expect(free.statusCode).toBe(200);
    expect(free.json()).toMatchObject({ status: "free", free_remaining_today: 0 });
    // Relecture du même raisonnement : il lui appartient désormais.
    const own = await json("POST", "/api/v1/lookup", q, B);
    expect(own.json().status).toBe("owned");

    const q2 = { ...q, question: "Quel est le montant estimé ?" };
    await json("POST", "/api/v1/publish", { ...q2, result: "Montant estimé : 120 000 € HT sur 36 mois, reconductible.", wallet: "WALLET_A" }, A);
    const r = await json("POST", "/api/v1/lookup", q2, B);
    expect(r.statusCode).toBe(402);
    expect(r.headers["x-payment-required"]).toBe("solana-usdc");
    const j = r.json();
    expect(j.pay.to_seller).toEqual({ wallet: "WALLET_A", micro_usdc: 95_000 });
    expect(j.pay.to_platform).toEqual({ wallet: "PLATFORM", micro_usdc: 5_000 });
    expect(j.pay.memo).toBe("deja:" + j.fingerprint);
  });

  it("B paie : mauvaise signature refusée, bonne signature livrée, rejouée refusée", async () => {
    const q2 = { ...q, question: "Quel est le montant estimé ?", wallet: "WALLET_B" };
    const bad = await json("POST", "/api/v1/lookup", q2, { ...B, "x-payment": "BAD1" });
    expect(bad.statusCode).toBe(402);
    const good = await json("POST", "/api/v1/lookup", q2, { ...B, "x-payment": "GOOD1" });
    expect(good.statusCode).toBe(200);
    expect(good.json().status).toBe("purchased");
    expect(good.json().result).toContain("120 000");
    const replay = await json("POST", "/api/v1/lookup", q2, { ...B, "x-payment": "GOOD1" });
    expect(replay.statusCode).toBe(200); // déjà acheté → owned, sans revérifier
    expect(replay.json().status).toBe("owned");
    expect(verified).toEqual(["GOOD1"]);
  });

  it("les statistiques agents sont cohérentes", async () => {
    const s = (await json("GET", "/stats")).json();
    expect(s.agents.agents).toBe(2);
    expect(s.agents.free_grants).toBe(1);
    expect(s.agents.payment_required).toBe(1);
    expect(s.agents.payment_ok).toBe(1);
    expect(s.agents.agent_publishes).toBe(2);
    expect(s.agents.pay_rate).toBeCloseTo(1);
  });
});
