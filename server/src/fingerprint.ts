import { createHash } from "node:crypto";

/**
 * Empreinte d'un raisonnement : même demande + même contexte => même empreinte.
 * Version 1 : normalisation textuelle simple. La correspondance sémantique
 * (deux formulations différentes de la même tâche) viendra en version 2.
 */

export function normalizeTask(task: string): string {
  return task
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // accents
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // ponctuation
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeContext(pageText: string): string {
  return pageText.replace(/\s+/g, " ").trim().slice(0, 20000);
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function contextHash(url: string, pageText: string): string {
  // On ignore les paramètres de suivi dans l'URL (utm_*, fbclid...)
  let cleanUrl = url;
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hash = "";
    cleanUrl = u.toString();
  } catch {
    /* URL invalide ou absente : on garde la chaîne brute */
  }
  return sha256(cleanUrl + "\n" + normalizeContext(pageText));
}

export function fingerprint(task: string, url: string, pageText: string): string {
  return sha256(normalizeTask(task) + "|" + contextHash(url, pageText));
}

/** Empreinte d'une demande sur un document connu du serveur (avis BOAMP, etc.). */
export function fingerprintDoc(task: string, docId: string): string {
  return sha256(normalizeTask(task) + "|doc:" + docId);
}
