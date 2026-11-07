import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import { createAssociatedTokenAccountIdempotentInstruction, createTransferCheckedInstruction, getAssociatedTokenAddressSync } from "@solana/spl-token";
import bs58 from "bs58";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const RPC: Record<string, string> = {
  "solana-devnet": process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
  "solana-mainnet-beta": process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com",
};

export function loadWallet(secret?: string): Keypair | null {
  if (!secret) return null;
  const s = secret.trim();
  if (s.startsWith("[")) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(s)));
  return Keypair.fromSecretKey(bs58.decode(s));
}

export type PayInstructions = {
  network: string;
  mint: string;
  to_seller: { wallet: string; micro_usdc: number };
  to_platform: { wallet: string; micro_usdc: number };
  memo: string;
};

/** Un seul envoi : part du vendeur, commission, et la preuve (memo). Retourne la signature. */
export async function payQuote(buyer: Keypair, p: PayInstructions): Promise<string> {
  const conn = new Connection(RPC[p.network] ?? RPC["solana-devnet"], "confirmed");
  const mint = new PublicKey(p.mint);
  const seller = new PublicKey(p.to_seller.wallet);
  const platform = new PublicKey(p.to_platform.wallet);
  const from = getAssociatedTokenAddressSync(mint, buyer.publicKey);
  const toSeller = getAssociatedTokenAddressSync(mint, seller);
  const toPlatform = getAssociatedTokenAddressSync(mint, platform);
  const tx = new Transaction().add(
    createAssociatedTokenAccountIdempotentInstruction(buyer.publicKey, toSeller, seller, mint),
    createAssociatedTokenAccountIdempotentInstruction(buyer.publicKey, toPlatform, platform, mint),
    createTransferCheckedInstruction(from, mint, toSeller, buyer.publicKey, BigInt(p.to_seller.micro_usdc), 6),
    createTransferCheckedInstruction(from, mint, toPlatform, buyer.publicKey, BigInt(p.to_platform.micro_usdc), 6),
    new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM, data: Buffer.from(p.memo, "utf8") })
  );
  return sendAndConfirmTransaction(conn, tx, [buyer], { commitment: "confirmed" });
}
