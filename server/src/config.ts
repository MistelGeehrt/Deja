import "dotenv/config";

export type Config = {
  port: number;
  dbPath: string;
  priceMicroUsdc: number;
  feeBps: number;
  platformWallet: string;
  usdcMint: string;
  rpcUrl: string;
  cluster: string;
  model?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
  skipChainVerify: boolean;
  /** Adresse publique du site, pour le sitemap (ex. https://deja.mistelgeehrt.com) */
  publicUrl: string;
  seedMaxPerRun: number;
  /** Mot de passe simple pour /tableau (vide = libre) */
  dashboardKey: string;
};

export function configFromEnv(): Config {
  const e = process.env;
  return {
    port: Number(e.PORT ?? 8787),
    dbPath: e.DEJA_DB ?? "./deja.sqlite",
    priceMicroUsdc: Number(e.DEJA_PRICE_MICRO_USDC ?? 100_000), // 0,10 USDC
    feeBps: Number(e.DEJA_FEE_BPS ?? 500), // 5 %
    platformWallet: e.DEJA_PLATFORM_WALLET ?? "",
    usdcMint: e.DEJA_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    rpcUrl: e.SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    cluster: e.SOLANA_CLUSTER ?? "devnet",
    model: e.DEJA_MODEL || undefined,
    anthropicApiKey: e.ANTHROPIC_API_KEY || undefined,
    openaiApiKey: e.OPENAI_API_KEY || undefined,
    skipChainVerify: e.DEJA_SKIP_CHAIN_VERIFY === "1",
    publicUrl: (e.DEJA_PUBLIC_URL ?? "http://localhost:8787").replace(/\/$/, ""),
    seedMaxPerRun: Number(e.DEJA_SEED_MAX ?? 50),
    dashboardKey: e.DEJA_DASHBOARD_KEY ?? "",
  };
}

export function splitPrice(price: number, feeBps: number) {
  const fee = Math.floor((price * feeBps) / 10_000);
  return { fee, sellerAmount: price - fee };
}
