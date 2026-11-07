/**
 * Le semeur : récupère les nouveaux avis BOAMP et produit, pour chacun,
 * les analyses standard, mises en vente au nom du wallet de la plateforme.
 *
 *   npm run seed            → un passage (avis du jour)
 *   npm run seed -- --loop  → toutes les heures
 *   npm run seed -- --day 2026-11-06 --max 20
 */
import "dotenv/config";
import { openDb, type Db, type Document } from "./db.js";
import { fetchBoampDay, type NewDocument } from "./boamp.js";
import { makeAgent, type Agent } from "./agent.js";
import { fingerprintDoc } from "./fingerprint.js";
import { configFromEnv, type Config } from "./config.js";
import { makeEmbedder, type Embedder } from "./embeddings.js";

/** Les questions que toute entreprise se pose devant un avis. L'ordre compte : c'est l'ordre d'affichage. */
export const STANDARD_QUESTIONS = [
  "Résume cet avis de marché en 5 points",
  "Quelles sont les conditions pour candidater et les pièces à fournir ?",
  "Quelles sont les dates clés, la durée et le montant estimé ?",
  "Une PME peut-elle raisonnablement répondre à ce marché ? Points d'attention et pièges",
];

export async function seedDocument(db: Db, agent: Agent, cfg: Config, doc: Document, log = console.log, embed: Embedder = null) {
  let made = 0;
  for (const q of STANDARD_QUESTIONS) {
    const fp = fingerprintDoc(q, doc.id);
    if (db.find(fp)) continue;
    const result = await agent(q, doc.url, doc.text);
    db.insert({
      fingerprint: fp,
      task: q,
      context_url: doc.url,
      doc_id: doc.id,
      result,
      seller_wallet: cfg.platformWallet || "plateforme",
      price_micro_usdc: cfg.priceMicroUsdc,
    });
    made++;
    // On mémorise le « sens » de la question pour que les formulations proches la retrouvent.
    if (embed) {
      try {
        db.logQuestion({ docId: doc.id, url: doc.url, task: q, fingerprint: fp, embedding: await embed(q), outcome: "owned" });
      } catch {
        /* sans embedding : on fait sans */
      }
    }
  }
  if (made) log(`  ${doc.id} — ${made} analyse(s) produite(s) : ${doc.title.slice(0, 70)}`);
  return made;
}

export async function seedOnce(db: Db, agent: Agent, cfg: Config, opts: { day?: string; max?: number; log?: typeof console.log; embed?: Embedder } = {}) {
  const log = opts.log ?? console.log;
  const max = opts.max ?? cfg.seedMaxPerRun;
  // Sans jour précis : aujourd'hui ET hier, car le BOAMP publie en journée et un passage matinal verrait 0 avis.
  const days = opts.day ? [opts.day] : [0, 1].map((d) => new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10));
  log(`[semeur] récupération BOAMP (${days.join(", ")})…`);
  let fetched: NewDocument[] = [];
  for (const day of days) {
    try {
      fetched.push(...(await fetchBoampDay({ day, limit: max })));
    } catch (e) {
      log(`[semeur] BOAMP injoignable (${day}) : ${(e as Error).message}`);
    }
  }
  let added = 0;
  for (const d of fetched) {
    if (!db.docHas(d.id)) {
      db.docInsert(d);
      added++;
    }
  }
  log(`[semeur] ${fetched.length} avis lus, ${added} nouveaux`);

  // On complète d'abord les avis les plus récents qui n'ont pas encore leurs analyses.
  const todo = db.docUnseeded(STANDARD_QUESTIONS.length, max);
  let made = 0;
  for (const doc of todo) {
    try {
      made += await seedDocument(db, agent, cfg, doc, log, opts.embed ?? null);
    } catch (e) {
      log(`  ${doc.id} — erreur : ${(e as Error).message}`);
    }
  }
  log(`[semeur] ${made} analyses produites sur ${todo.length} avis`);
  return { fetched: fetched.length, added, made };
}

// Lancement direct
if (process.argv[1] && /seeder\.(ts|js)$/.test(process.argv[1])) {
  const args = process.argv.slice(2);
  const get = (k: string) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
  const cfg = configFromEnv();
  const db = openDb(cfg.dbPath);
  const agent = makeAgent({ anthropicApiKey: cfg.anthropicApiKey, openaiApiKey: cfg.openaiApiKey, model: cfg.model });
  const embed = makeEmbedder(cfg.openaiApiKey);
  const run = () => seedOnce(db, agent, cfg, { day: get("--day"), max: get("--max") ? Number(get("--max")) : undefined, embed });
  if (args.includes("--loop")) {
    const every = Number(get("--every") ?? 60) * 60_000;
    const tick = () => run().catch((e) => console.error("[semeur]", e)).finally(() => setTimeout(tick, every));
    tick();
  } else {
    run().then(() => process.exit(0));
  }
}
