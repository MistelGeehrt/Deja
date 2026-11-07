/**
 * Récupération des avis de marchés publics depuis l'API open data officielle du BOAMP (DILA).
 * Licence Ouverte / Open Licence 2.0 — source à créditer : BOAMP / DILA.
 */
import type { Document } from "./db.js";

const API = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records";

type RawRecord = Record<string, unknown>;

function str(v: unknown): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(str).filter(Boolean).join(", ");
  if (typeof v === "object") return "";
  return String(v);
}

/** Aplatit le JSON imbriqué du champ `donnees` en texte lisible "clé : valeur". */
export function flattenDonnees(input: unknown, prefix = "", out: string[] = [], depth = 0): string[] {
  if (depth > 8 || input == null) return out;
  if (typeof input === "string") {
    let parsed: unknown = null;
    if (input.trim().startsWith("{")) {
      try {
        parsed = JSON.parse(input);
      } catch {
        /* texte brut */
      }
    }
    if (parsed) return flattenDonnees(parsed, prefix, out, depth + 1);
    const t = input.replace(/\s+/g, " ").trim();
    if (t) out.push(prefix ? `${prefix} : ${t}` : t);
    return out;
  }
  if (typeof input === "number" || typeof input === "boolean") {
    out.push(`${prefix} : ${input}`);
    return out;
  }
  if (Array.isArray(input)) {
    input.forEach((v) => flattenDonnees(v, prefix, out, depth + 1));
    return out;
  }
  if (typeof input === "object") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (/^(@|_)/.test(k)) continue;
      flattenDonnees(v, prefix ? `${prefix} › ${k}` : k, out, depth + 1);
    }
  }
  return out;
}

export type NewDocument = Omit<Document, "created_at">;

export function recordToDocument(r: RawRecord): NewDocument | null {
  const id = str(r.idweb);
  if (!id) return null;
  const title = str(r.objet) || `Avis ${id}`;
  const lines = [
    `Objet : ${title}`,
    `Acheteur : ${str(r.nomacheteur)}`,
    `Nature : ${str(r.nature_libelle) || str(r.nature)}`,
    `Famille : ${str(r.famille_libelle) || str(r.famille)}`,
    `Type de marché : ${str(r.type_marche) || str(r.type_marche_facette)}`,
    `Procédure : ${str(r.procedure_libelle) || str(r.procedure_categorise)}`,
    `Département : ${str(r.code_departement)}`,
    `Descripteurs : ${str(r.descripteur_libelle) || str(r.descripteur_code)}`,
    `Date de parution : ${str(r.dateparution)}`,
    `Date limite de réponse : ${str(r.datelimitereponse)}`,
    `Lien officiel : ${str(r.url_avis)}`,
    "",
    "--- Contenu de l'avis ---",
    ...flattenDonnees(r.donnees),
  ].filter((l) => !/: $/.test(l));
  return {
    id,
    source: "boamp",
    url: str(r.url_avis) || `https://www.boamp.fr/pages/avis/?q=idweb:${id}`,
    title,
    buyer: str(r.nomacheteur),
    published: str(r.dateparution).slice(0, 10),
    deadline: str(r.datelimitereponse),
    text: lines.join("\n").slice(0, 60000),
  };
}

export type FetchOptions = {
  /** Jour de parution (YYYY-MM-DD). Par défaut : aujourd'hui. */
  day?: string;
  /** Nombre maximum d'avis à récupérer. */
  limit?: number;
  /** Mots-clés ODSQL optionnels, ex. `type_marche = "SERVICES"`. */
  where?: string;
  fetchImpl?: typeof fetch;
};

export async function fetchBoampDay(opts: FetchOptions = {}): Promise<NewDocument[]> {
  const f = opts.fetchImpl ?? fetch;
  const day = opts.day ?? new Date().toISOString().slice(0, 10);
  const limit = Math.min(opts.limit ?? 100, 1000);
  const where = [`dateparution = date'${day}'`, `nature = "APPEL_OFFRE"`, opts.where].filter(Boolean).join(" AND ");
  const docs: NewDocument[] = [];
  const pageSize = 100;
  for (let offset = 0; offset < limit; offset += pageSize) {
    const url = new URL(API);
    url.searchParams.set("where", where);
    url.searchParams.set("limit", String(Math.min(pageSize, limit - offset)));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("order_by", "idweb");
    const res = await f(url.toString(), { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`BOAMP ${res.status} : ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as { results?: RawRecord[] };
    const batch = (j.results ?? []).map(recordToDocument).filter((d): d is NewDocument => !!d);
    docs.push(...batch);
    if (batch.length < pageSize) break;
  }
  return docs;
}
