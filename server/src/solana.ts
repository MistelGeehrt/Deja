import { Connection, type ParsedTransactionWithMeta } from "@solana/web3.js";

export type ChainConfig = {
  rpcUrl: string;
  usdcMint: string;
  platformWallet: string;
};

export type VerifyRequest = {
  signature: string;
  buyerWallet: string;
  sellerWallet: string;
  sellerAmount: number; // micro-USDC
  feeAmount: number; // micro-USDC
  memo: string; // empreinte attendue
};

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/** Solde USDC (en micro-unités) par propriétaire, avant/après la transaction. */
function balancesByOwner(
  list: NonNullable<ParsedTransactionWithMeta["meta"]>["preTokenBalances"],
  mint: string
) {
  const out = new Map<string, bigint>();
  for (const b of list ?? []) {
    const owner = b.owner as string | undefined;
    if ((b.mint as string) !== mint || !owner) continue;
    out.set(owner, (out.get(owner) ?? 0n) + BigInt(b.uiTokenAmount.amount));
  }
  return out;
}

export function checkParsedTx(tx: ParsedTransactionWithMeta | null, cfg: ChainConfig, req: VerifyRequest): VerifyResult {
  if (!tx || !tx.meta) return { ok: false, reason: "transaction introuvable" };
  if (tx.meta.err) return { ok: false, reason: "transaction échouée sur la chaîne" };

  const keys = tx.transaction.message.accountKeys;
  const signers: string[] = keys.filter((k) => k.signer).map((k) => String(k.pubkey.toBase58()));
  if (!signers.includes(req.buyerWallet)) return { ok: false, reason: "l'acheteur n'a pas signé cette transaction" };

  const pre = balancesByOwner(tx.meta.preTokenBalances, cfg.usdcMint);
  const post = balancesByOwner(tx.meta.postTokenBalances, cfg.usdcMint);
  const delta = (owner: string) => (post.get(owner) ?? 0n) - (pre.get(owner) ?? 0n);

  if (delta(req.sellerWallet) < BigInt(req.sellerAmount))
    return { ok: false, reason: "le vendeur n'a pas reçu le montant attendu" };
  if (delta(cfg.platformWallet) < BigInt(req.feeAmount))
    return { ok: false, reason: "la commission n'a pas été versée" };

  const memos: string[] = [];
  for (const ix of tx.transaction.message.instructions) {
    if ("parsed" in ix && ix.program === "spl-memo" && typeof ix.parsed === "string") memos.push(ix.parsed);
  }
  if (!memos.some((m) => m.includes(req.memo))) return { ok: false, reason: "la preuve (memo) ne correspond pas" };

  return { ok: true };
}

export function makeVerifier(cfg: ChainConfig) {
  const conn = new Connection(cfg.rpcUrl, "confirmed");
  return async (req: VerifyRequest): Promise<VerifyResult> => {
    let tx: ParsedTransactionWithMeta | null = null;
    // La transaction peut mettre quelques secondes à être visible : on réessaie.
    for (let i = 0; i < 8 && !tx; i++) {
      tx = await conn.getParsedTransaction(req.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (!tx) await new Promise((r) => setTimeout(r, 1500));
    }
    return checkParsedTx(tx, cfg, req);
  };
}
