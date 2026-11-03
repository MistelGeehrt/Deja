import { Buffer } from "buffer";
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
  TokenAccountNotFoundError,
} from "@solana/spl-token";

const MEMO_PROGRAM = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const USDC_DECIMALS = 6;

/** Le wallet de l'extension : une paire de clés créée localement et gardée dans le stockage de Chrome. */
export async function loadOrCreateWallet(): Promise<Keypair> {
  const { secretKey } = await chrome.storage.local.get("secretKey");
  if (typeof secretKey === "string") return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secretKey)));
  const kp = Keypair.generate();
  await chrome.storage.local.set({ secretKey: JSON.stringify(Array.from(kp.secretKey)) });
  return kp;
}

export async function balances(conn: Connection, owner: PublicKey, usdcMint: PublicKey) {
  const sol = (await conn.getBalance(owner)) / 1e9;
  let usdc = 0;
  try {
    const acc = await getAccount(conn, getAssociatedTokenAddressSync(usdcMint, owner));
    usdc = Number(acc.amount) / 10 ** USDC_DECIMALS;
  } catch (e) {
    if (!(e instanceof TokenAccountNotFoundError)) throw e;
  }
  return { sol, usdc };
}

export type Quote = {
  fingerprint: string;
  seller_wallet: string;
  seller_amount_micro_usdc: number;
  fee_micro_usdc: number;
  platform_wallet: string;
};

/**
 * Paie un raisonnement : un seul envoi contenant
 *   - le virement USDC au vendeur,
 *   - la commission à la plateforme,
 *   - la preuve (memo) qui relie le paiement à l'empreinte.
 * Retourne la signature, que le serveur vérifiera avant de livrer.
 */
export async function payQuote(conn: Connection, buyer: Keypair, usdcMint: PublicKey, q: Quote): Promise<string> {
  const seller = new PublicKey(q.seller_wallet);
  const platform = new PublicKey(q.platform_wallet);
  const from = getAssociatedTokenAddressSync(usdcMint, buyer.publicKey);
  const toSeller = getAssociatedTokenAddressSync(usdcMint, seller);
  const toPlatform = getAssociatedTokenAddressSync(usdcMint, platform);

  const tx = new Transaction().add(
    // Crée les comptes USDC des destinataires s'ils n'existent pas encore (sans effet sinon).
    createAssociatedTokenAccountIdempotentInstruction(buyer.publicKey, toSeller, seller, usdcMint),
    createAssociatedTokenAccountIdempotentInstruction(buyer.publicKey, toPlatform, platform, usdcMint),
    createTransferCheckedInstruction(from, usdcMint, toSeller, buyer.publicKey, BigInt(q.seller_amount_micro_usdc), USDC_DECIMALS),
    createTransferCheckedInstruction(from, usdcMint, toPlatform, buyer.publicKey, BigInt(q.fee_micro_usdc), USDC_DECIMALS),
    new TransactionInstruction({ keys: [], programId: MEMO_PROGRAM, data: Buffer.from(new TextEncoder().encode("deja:" + q.fingerprint)) })
  );
  return sendAndConfirmTransaction(conn, tx, [buyer], { commitment: "confirmed" });
}
