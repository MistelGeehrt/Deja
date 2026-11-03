import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "chrome120",
  minify: false,
  sourcemap: false,
  logLevel: "info",
};

await build({ ...common, entryPoints: ["src/background.ts"], outfile: "dist/background.js" });
await build({
  ...common,
  entryPoints: ["src/sidepanel.ts"],
  outfile: "dist/sidepanel.js",
  // @solana/web3.js v1 a besoin de Buffer dans le navigateur
  inject: ["./src/buffer-shim.js"],
  define: { "process.env.NODE_ENV": '"production"', global: "globalThis" },
});
