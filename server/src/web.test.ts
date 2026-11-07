import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp, type Config } from "./server.js";
import { openDb } from "./db.js";
import { recordToDocument, flattenDonnees } from "./boamp.js";
import { seedOnce, STANDARD_QUESTIONS } from "./seeder.js";
import { makeAgent } from "./agent.js";

const cfg: Config = {
  port: 0,
  dbPath: ":memory:",
  priceMicroUsdc: 100_000,
  feeBps: 500,
  platformWallet: "PLATFORM",
  usdcMint: "USDC",
  rpcUrl: "",
  cluster: "test",
  skipChainVerify: true,
  publicUrl: "http://test",
  seedMaxPerRun: 5,
  dashboardKey: "secret",
};

const record = {
  idweb: "26-100275",
  objet: "Prestations de services informatiques",
  nomacheteur: "Communauté d'agglomération de Test",
  nature: "APPEL_OFFRE",
  nature_libelle: "Avis de marché",
  dateparution: "2026-11-06",
  datelimitereponse: "2026-12-01T11:00:00+00:00",
  url_avis: "https://www.boamp.fr/pages/avis/?q=idweb:26-100275",
  donnees: JSON.stringify({ FNSimple: { organisme: { nom: "CA Test", ville: "Testville" }, initial: { description: "Maintenance logicielle", duree: "36 mois" } } }),
};

describe("BOAMP", () => {
  it("transforme un enregistrement en document lisible", () => {
    const d = recordToDocument(record)!;
    expect(d.id).toBe("26-100275");
    expect(d.published).toBe("2026-11-06");
    expect(d.text).toContain("Objet : Prestations de services informatiques");
    expect(d.text).toContain("initial › description : Maintenance logicielle");
  });
  it("aplatit le JSON imbriqué", () => {
    expect(flattenDonnees({ a: { b: "x" }, c: ["y", "z"] })).toEqual(["a › b : x", "c : y", "c : z"]);
  });
});

describe("semeur", () => {
  it("récupère les avis et produit les analyses standard au nom de la plateforme", async () => {
    const db = openDb(":memory:");
    let calls = 0;
    const agent = async (t: string) => (calls++, "analyse : " + t);
    // On injecte un faux BOAMP en remplaçant fetch globalement le temps du test.
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ results: [record] }), { status: 200 })) as typeof fetch;
    try {
      const r = await seedOnce(db, agent, cfg, { log: () => {} });
      expect(r).toEqual({ fetched: 1, added: 1, made: STANDARD_QUESTIONS.length });
      const again = await seedOnce(db, agent, cfg, { log: () => {} });
      expect(again.made).toBe(0); // déjà fait : rien de recalculé
    } finally {
      globalThis.fetch = realFetch;
    }
    expect(calls).toBe(STANDARD_QUESTIONS.length);
    expect(db.byDoc("26-100275").every((r) => r.seller_wallet === "PLATFORM")).toBe(true);
  });
});

describe("site public avec document", () => {
  // Faux « sens » : deux questions sont proches si elles parlent toutes deux de délai.
  const embed = async (t: string) => {
    const delai = /d[ée]lai/i.test(t);
    return [delai ? 1 : 0, delai ? 0 : 1, 0.1];
  };
  let calls = 0;
  const dbPath = `/tmp/deja-web-test-${process.pid}.sqlite`;
  const db = openDb(dbPath);
  db.docInsert(recordToDocument(record)!);
  const app = buildApp({ ...cfg, dbPath }, { agent: async (t) => (calls++, "réponse à : " + t), embed });
  beforeAll(() => app.ready());
  afterAll(async () => {
    await app.close();
    const fs = await import("node:fs");
    for (const f of [dbPath, dbPath + "-wal", dbPath + "-shm"]) fs.rmSync(f, { force: true });
  });
  const cookieHeader = (r: { cookies: { name: string; value: string }[] }) => r.cookies.map((c) => `${c.name}=${c.value}`).join("; ");

  it("la page de l'avis s'affiche et compte une vue", async () => {
    const r = await app.inject({ method: "GET", url: "/avis/26-100275" });
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("Prestations de services informatiques");
    expect(r.body).toContain("ne sont pas encore produites");
  });

  it("premier visiteur : question nouvelle, réponse offerte ; second visiteur : devis ; clic : intention", async () => {
    const a = await app.inject({ method: "POST", url: "/avis/26-100275/question", payload: "task=Quel+est+le+d%C3%A9lai+%3F", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(a.statusCode).toBe(200);
    expect(a.body).toContain("Vous êtes le premier");
    expect(calls).toBe(1);

    const b = await app.inject({ method: "POST", url: "/avis/26-100275/question", payload: "task=quel+est+le+delai+%3F", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(b.body).toContain("Déjà pensé");
    expect(b.body).toContain("Débloquer pour 0,10 €");
    expect(calls).toBe(1);

    // Quasi-doublon : formulation différente mais « même sens » selon notre faux embedder.
    const c = await app.inject({ method: "POST", url: "/avis/26-100275/question", payload: "task=D%C3%A9lai+d%27ex%C3%A9cution+du+march%C3%A9", headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(c.body).toContain("question proche");
    expect(calls).toBe(1);

    const fp = /name="fingerprint" value="([a-f0-9]+)"/.exec(b.body)![1];
    const click = await app.inject({ method: "POST", url: "/avis/26-100275/debloquer", payload: `fingerprint=${fp}`, headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader(b) } });
    expect(click.statusCode).toBe(303);
    const after = await app.inject({ method: "GET", url: "/avis/26-100275", headers: { cookie: cookieHeader(click) + "; " + cookieHeader(b) } });
    expect(after.body).toContain("Débloqué");
    expect(after.body).toContain("réponse à : Quel est le délai ?");
  });

  it("tableau de bord protégé, statistiques cohérentes, sitemap", async () => {
    expect((await app.inject({ method: "GET", url: "/tableau" })).statusCode).toBe(401);
    const t = await app.inject({ method: "GET", url: "/tableau?cle=secret" });
    expect(t.statusCode).toBe(200);
    const s = (await app.inject({ method: "GET", url: "/stats" })).json();
    expect(s.asks).toBe(3);
    expect(s.misses).toBe(1);
    expect(s.hits).toBe(1);
    expect(s.near_hits).toBe(1);
    expect(s.paywall_clicks).toBe(1);
    expect(s.near_duplicate_rate).toBeCloseTo(1); // (1 hit + 1 quasi) / (1 hit + 1 miss)
    const sm = await app.inject({ method: "GET", url: "/sitemap.xml" });
    expect(sm.body).toContain("http://test/avis/26-100275");
  });
});

describe("agent factice", () => {
  it("répond sans clé", async () => {
    const a = makeAgent({});
    expect(await a("x", "u", "p")).toContain("factice");
  });
});
