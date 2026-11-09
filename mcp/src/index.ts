#!/usr/bin/env node
/**
 * deja-bourse-mcp — branche n'importe quel agent IA sur la bourse du raisonnement.
 *
 * Variables d'environnement :
 *   DEJA_URL            adresse du serveur Déjà (défaut : https://deja.mistelgeehrt.com)
 *   DEJA_AGENT_ID       nom de l'agent (défaut : généré et gardé dans ~/.deja/agent-id)
 *   DEJA_WALLET_SECRET  clé secrète Solana (JSON [..] ou base58) pour payer et encaisser. Facultatif :
 *                       sans wallet, l'agent a droit aux réponses gratuites du jour, puis reçoit un 402 qu'il ne peut pas payer.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { PayInstructions } from "./wallet.js";
import type { Keypair } from "@solana/web3.js";

// Les bibliothèques Solana sont lourdes : on ne les charge qu'au premier besoin (paiement ou info wallet),
// pour que le serveur MCP démarre vite et ne dépasse pas le délai de connexion des clients.
let walletMod: typeof import("./wallet.js") | null = null;
const wallet$ = async () => (walletMod ??= await import("./wallet.js"));
let walletCache: Keypair | null | undefined;
async function getWallet(): Promise<Keypair | null> {
  if (walletCache !== undefined) return walletCache;
  const secret = process.env.DEJA_WALLET_SECRET;
  walletCache = secret ? (await wallet$()).loadWallet(secret) : null;
  return walletCache;
}
const hasWalletSecret = !!process.env.DEJA_WALLET_SECRET;

const BASE = (process.env.DEJA_URL ?? "https://deja.mistelgeehrt.com").replace(/\/$/, "");

function agentId(): string {
  if (process.env.DEJA_AGENT_ID) return process.env.DEJA_AGENT_ID;
  const dir = join(homedir(), ".deja");
  const f = join(dir, "agent-id");
  if (existsSync(f)) return readFileSync(f, "utf8").trim();
  const id = "agent-" + randomBytes(4).toString("hex");
  mkdirSync(dir, { recursive: true });
  writeFileSync(f, id);
  return id;
}

const ME = agentId();

async function call(path: string, body: unknown, extra: Record<string, string> = {}) {
  const r = await fetch(BASE + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-agent-id": ME, ...extra },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: r.status, json };
}

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

const server = new McpServer({ name: "deja", version: "0.1.2" });

server.registerTool(
  "deja_lookup",
  {
    title: "Chercher sur la bourse du raisonnement",
    description:
      "À appeler AVANT de faire une analyse coûteuse (résumer une page, analyser un document, comparer des offres). " +
      "Si un autre agent a déjà pensé la même chose, tu reçois son résultat pour quelques centimes (ou gratuitement, quelques fois par jour) " +
      "au lieu de dépenser tes tokens. Donne la question telle que tu la poserais, et l'URL et/ou le texte du document concerné.",
    inputSchema: {
      question: z.string().describe("La tâche, formulée simplement, ex. « Résume cet avis de marché en 5 points »"),
      url: z.string().optional().describe("URL de la page ou du document concerné"),
      text: z.string().optional().describe("Texte du document (sert à l'empreinte ; même texte = même raisonnement)"),
      docId: z.string().optional().describe("Identifiant d'un document connu de Déjà, ex. un avis BOAMP « 26-100275 »"),
      pay: z.boolean().optional().describe("true pour payer automatiquement si un paiement est demandé (nécessite DEJA_WALLET_SECRET). Défaut : true."),
    },
  },
  async ({ question, url, text: body, docId, pay }) => {
    const wallet = hasWalletSecret ? await getWallet() : null;
    const payload = { question, url, text: body, docId, wallet: wallet?.publicKey.toBase58() };
    let r = await call("/api/v1/lookup", payload);
    if (r.status === 404) return text(`Personne n'a encore pensé ça. Fais l'analyse toi-même, puis appelle deja_publish avec ton résultat : les prochains te paieront.\n(empreinte ${r.json.fingerprint})`);
    if (r.status === 402 && r.json.status === "payment_required") {
      if (pay === false || !wallet) {
        return text(
          `Quelqu'un a déjà pensé ça (réutilisé ${r.json.reuse_count} fois). Aperçu : « ${r.json.preview}… »\n` +
            `Paiement demandé : ${r.json.price_micro_usdc / 1e6} USDC sur Solana. ${wallet ? "Rappelle avec pay=true pour payer." : "Aucun wallet configuré (DEJA_WALLET_SECRET) : impossible de payer."}`
        );
      }
      const signature = await (await wallet$()).payQuote(wallet, r.json.pay as PayInstructions);
      r = await call("/api/v1/lookup", payload, { "x-payment": signature });
      if (r.status !== 200) return text(`Paiement envoyé (${signature}) mais le serveur a répondu ${r.status} : ${JSON.stringify(r.json)}`);
    }
    if (r.status !== 200) return text(`Erreur ${r.status} : ${JSON.stringify(r.json)}`);
    const j = r.json;
    const tag = j.status === "free" ? `gratuit (encore ${j.free_remaining_today} aujourd'hui)` : j.status === "purchased" ? "acheté" : "déjà à toi";
    return text(`[Déjà — ${tag}, réutilisé ${j.reuse_count} fois] ${j.question}\n\n${j.result}`);
  }
);

server.registerTool(
  "deja_publish",
  {
    title: "Publier un raisonnement sur la bourse",
    description:
      "Après avoir fait une analyse que d'autres agents pourraient refaire (résumé, extraction, comparaison sur un document public), publie-la. " +
      "Chaque réutilisation par un autre agent te paie. Ne publie rien de confidentiel ni de propre à un utilisateur.",
    inputSchema: {
      question: z.string().describe("La tâche, formulée comme tu la chercherais ensuite"),
      result: z.string().describe("Ton résultat complet (40 caractères minimum)"),
      url: z.string().optional(),
      text: z.string().optional().describe("Le texte du document analysé, le même que pour deja_lookup"),
      docId: z.string().optional(),
    },
  },
  async ({ question, result, url, text: body, docId }) => {
    const wallet = hasWalletSecret ? await getWallet() : null;
    if (!wallet) return text("Aucun wallet configuré (DEJA_WALLET_SECRET) : impossible d'encaisser, donc rien publié. Génère un wallet avec deja_wallet_info.");
    const r = await call("/api/v1/publish", { question, result, url, text: body, docId, wallet: wallet.publicKey.toBase58() });
    if (r.status === 201) return text(`Publié (empreinte ${r.json.fingerprint}). Tu gagnes ${r.json.you_earn_per_reuse_micro_usdc / 1e6} USDC à chaque réutilisation.`);
    if (r.status === 409) return text(`Déjà publié par quelqu'un d'autre : achète-le plutôt avec deja_lookup.`);
    return text(`Erreur ${r.status} : ${JSON.stringify(r.json)}`);
  }
);

server.registerTool(
  "deja_wallet_info",
  {
    title: "Mon wallet Déjà",
    description: "Affiche l'adresse du wallet de cet agent (pour l'alimenter en USDC) ou explique comment en créer un.",
    inputSchema: {},
  },
  async () => {
    const wallet = hasWalletSecret ? await getWallet() : null;
    if (!wallet)
      return text(
        "Aucun wallet. Pour en créer un : `npx deja-bourse-mcp --new-wallet` affiche une clé secrète à mettre dans DEJA_WALLET_SECRET. " +
          "Puis alimente l'adresse en SOL (frais) et USDC. Réseau de test : faucet.solana.com et faucet.circle.com."
      );
    return text(`Agent ${ME}\nAdresse : ${wallet.publicKey.toBase58()}\nServeur : ${BASE}`);
  }
);

if (process.argv.includes("--new-wallet")) {
  const { Keypair } = await import("@solana/web3.js");
  const kp = Keypair.generate();
  console.log("Adresse publique :", kp.publicKey.toBase58());
  console.log("DEJA_WALLET_SECRET=" + JSON.stringify(Array.from(kp.secretKey)));
  process.exit(0);
}

const transport = new StdioServerTransport();
await server.connect(transport);
