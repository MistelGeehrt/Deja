import { Connection, PublicKey, type Keypair } from "@solana/web3.js";
import { loadOrCreateWallet, balances, payQuote, type Quote } from "./wallet";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

type ServerConfig = { cluster: string; rpcUrl: string; usdcMint: string; platformWallet: string; priceMicroUsdc: number; feeBps: number };

let wallet: Keypair;
let server = "http://localhost:8787";
let cfg: ServerConfig | null = null;
let conn: Connection | null = null;
let currentQuote: Quote | null = null;

function status(msg: string, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = isError ? "err" : "muted";
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(server + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error ?? r.statusText);
  return j as T;
}

async function loadConfig() {
  try {
    cfg = await api<ServerConfig>("/config");
    conn = new Connection(cfg.rpcUrl, "confirmed");
    $("cluster").textContent = cfg.cluster;
    await refreshBalances();
  } catch (e) {
    cfg = null;
    $("cluster").textContent = "serveur injoignable";
    status("Impossible de joindre le serveur Déjà (" + server + ").", true);
  }
}

async function refreshBalances() {
  if (!conn || !cfg) return;
  try {
    const b = await balances(conn, wallet.publicKey, new PublicKey(cfg.usdcMint));
    $("balSol").textContent = `SOL : ${b.sol.toFixed(4)}`;
    $("balUsdc").textContent = `USDC : ${b.usdc.toFixed(2)}`;
  } catch {
    $("balSol").textContent = "SOL : ?";
    $("balUsdc").textContent = "USDC : ?";
  }
}

/** Lit le texte de l'onglet actif. */
async function readActiveTab(): Promise<{ url: string; text: string }> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return { url: tab?.url ?? "", text: "" };
  const [res] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.body?.innerText?.slice(0, 60000) ?? "",
  });
  return { url: tab.url, text: String(res?.result ?? "") };
}

function showResult(text: string, badge: string, cls: string) {
  $("quote").hidden = true;
  $("resultCard").hidden = false;
  $("result").textContent = text;
  const b = $("resultBadge");
  b.textContent = badge;
  b.className = "badge " + cls;
}

async function ask() {
  const task = $<HTMLTextAreaElement>("task").value.trim();
  if (!task) return;
  if (!cfg) await loadConfig();
  if (!cfg) return;
  $<HTMLButtonElement>("go").disabled = true;
  $("resultCard").hidden = true;
  $("quote").hidden = true;
  try {
    status("Lecture de la page…");
    const page = await readActiveTab();
    status("Recherche sur la bourse…");
    const r = await api<any>("/solve", { task, url: page.url, pageText: page.text, wallet: wallet.publicKey.toBase58() });
    if (r.status === "quote") {
      currentQuote = r;
      $("preview").textContent = r.preview + "…";
      $("reuse").textContent = r.reuse_count ? `réutilisé ${r.reuse_count} fois` : "première réutilisation";
      $("price").textContent = (r.price_micro_usdc / 1e6).toFixed(2);
      $("quote").hidden = false;
      status("Quelqu'un a déjà fait ce raisonnement.");
    } else if (r.status === "owned") {
      showResult(r.result, "À toi — gratuit", "hit");
      status("");
    } else {
      showResult(r.result, "Nouveau — mis en vente à ton profit", "new");
      status("Chaque réutilisation par quelqu'un d'autre te rapportera " + ((cfg.priceMicroUsdc * (1 - cfg.feeBps / 10000)) / 1e6).toFixed(3) + " USDC.");
    }
  } catch (e: any) {
    status("Erreur : " + (e?.message ?? e), true);
  } finally {
    $<HTMLButtonElement>("go").disabled = false;
  }
}

async function buy() {
  if (!currentQuote || !cfg || !conn) return;
  $<HTMLButtonElement>("buy").disabled = true;
  try {
    status("Paiement sur Solana…");
    const signature = await payQuote(conn, wallet, new PublicKey(cfg.usdcMint), currentQuote);
    status("Paiement envoyé, vérification…");
    const r = await api<any>("/buy", { fingerprint: currentQuote.fingerprint, signature, wallet: wallet.publicKey.toBase58() });
    showResult(r.result, "Acheté", "hit");
    status("");
    await refreshBalances();
  } catch (e: any) {
    status("Paiement impossible : " + (e?.message ?? e), true);
  } finally {
    $<HTMLButtonElement>("buy").disabled = false;
  }
}

async function main() {
  wallet = await loadOrCreateWallet();
  $("address").textContent = wallet.publicKey.toBase58();
  const stored = await chrome.storage.local.get("server");
  if (typeof stored.server === "string") server = stored.server;
  $<HTMLInputElement>("server").value = server;

  $("go").addEventListener("click", ask);
  $("buy").addEventListener("click", buy);
  $("refresh").addEventListener("click", refreshBalances);
  $("saveServer").addEventListener("click", async () => {
    server = $<HTMLInputElement>("server").value.trim().replace(/\/$/, "");
    await chrome.storage.local.set({ server });
    await loadConfig();
  });
  $("exportKey").addEventListener("click", async () => {
    const { secretKey } = await chrome.storage.local.get("secretKey");
    await navigator.clipboard.writeText(String(secretKey));
    status("Clé secrète copiée dans le presse-papiers. Ne la partage avec personne.");
  });
  $<HTMLTextAreaElement>("task").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) ask();
  });

  await loadConfig();
}

main();
