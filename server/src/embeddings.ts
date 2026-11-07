/**
 * Représentation numérique du sens d'une question, pour repérer les quasi-doublons
 * (même question, mots différents). Utilise OpenAI si une clé est là ; sinon désactivé.
 */
export type Embedder = ((text: string) => Promise<number[]>) | null;

export function makeEmbedder(openaiApiKey?: string): Embedder {
  if (!openaiApiKey) return null;
  return async (text) => {
    const r = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${openaiApiKey}` },
      body: JSON.stringify({ model: "text-embedding-3-small", input: text.slice(0, 2000) }),
    });
    if (!r.ok) throw new Error(`OpenAI embeddings ${r.status}`);
    const j = (await r.json()) as { data: { embedding: number[] }[] };
    return j.data[0].embedding;
  };
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Seuil au-dessus duquel deux questions sont considérées comme « la même ». */
export const NEAR_THRESHOLD = 0.86;
