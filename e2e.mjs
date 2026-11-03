// Test de bout en bout : charge l'extension dans Chromium, ouvre le panneau, pose une question.
import pw from "/opt/npm-tools/node_modules/playwright/index.js";
const { chromium } = pw;
import path from "node:path";
import fs from "node:fs";

const ext = path.resolve("extension");
const userDir = fs.mkdtempSync("/tmp/deja-profile-");
const ctx = await chromium.launchPersistentContext(userDir, {
  headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--headless=new"],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent("serviceworker");
const id = new URL(sw.url()).host;

const page = await ctx.newPage();
await page.setContent("<h1>Facture 2026-11</h1><p>Total : 1 200 € TTC. Échéance : 30 jours.</p>");
await page.goto("data:text/html,<h1>Facture</h1><p>Total 1200 euros, echeance 30 jours</p>");

const panel = await ctx.newPage();
const errors = [];
panel.on("pageerror", (e) => errors.push(String(e)));
panel.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await panel.goto(`chrome-extension://${id}/sidepanel.html`);
await panel.waitForFunction(() => document.getElementById("address").textContent.length > 30);
console.log("wallet :", await panel.textContent("#address"));
console.log("cluster:", await panel.textContent("#cluster"));

await panel.fill("#task", "Quel est le montant de cette facture ?");
await panel.click("#go");
await panel.waitForSelector("#resultCard:not([hidden])", { timeout: 20000 });
console.log("badge  :", await panel.textContent("#resultBadge"));
console.log("result :", (await panel.textContent("#result")).slice(0, 80));
console.log("errors :", errors);
await ctx.close();
