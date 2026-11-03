import Anthropic from "@anthropic-ai/sdk";

const SYSTEM = `Tu es l'agent d'un navigateur. On te donne une demande de l'utilisateur et le texte de la page qu'il consulte.
Réponds de façon complète, structurée et réutilisable : ta réponse sera revendue à d'autres personnes qui auront
exactement la même demande sur la même page. N'invente rien qui ne soit pas dans la page ; si la page ne suffit pas, dis-le.
Réponds dans la langue de la demande.`;

export type Agent = (task: string, url: string, pageText: string) => Promise<string>;

export type AgentOptions = {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  model?: string; // optionnel : modèle imposé, sinon un défaut par fournisseur
};

function userPrompt(task: string, url: string, pageText: string) {
  return `Page : ${url}\n\n--- Texte de la page ---\n${pageText.slice(0, 60000)}\n--- Fin ---\n\nDemande : ${task}`;
}

/** Choisit le fournisseur selon la clé disponible : Anthropic d'abord, sinon OpenAI, sinon mode factice. */
export function makeAgent(opts: AgentOptions): Agent {
  if (opts.anthropicApiKey) {
    const client = new Anthropic({ apiKey: opts.anthropicApiKey });
    const model = opts.model ?? "claude-sonnet-5-5";
    return async (task, url, pageText) => {
      const msg = await client.messages.create({
        model,
        max_tokens: 2000,
        system: SYSTEM,
        messages: [{ role: "user", content: userPrompt(task, url, pageText) }],
      });
      return msg.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n");
    };
  }

  if (opts.openaiApiKey) {
    const model = opts.model ?? "gpt-4o-mini";
    return async (task, url, pageText) => {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${opts.openaiApiKey}` },
        body: JSON.stringify({
          model,
          max_tokens: 2000,
          messages: [
            { role: "system", content: SYSTEM },
            { role: "user", content: userPrompt(task, url, pageText) },
          ],
        }),
      });
      if (!r.ok) throw new Error(`OpenAI ${r.status} : ${(await r.text()).slice(0, 300)}`);
      const j = (await r.json()) as { choices: { message: { content: string } }[] };
      return j.choices[0]?.message?.content ?? "";
    };
  }

  // Mode sans clé : utile pour tester la bourse sans dépenser de tokens.
  return async (task, url) => `[Réponse factice — aucune clé API configurée]\nDemande : ${task}\nPage : ${url}`;
}
