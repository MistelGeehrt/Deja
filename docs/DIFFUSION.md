# Diffusion de deja-bourse-mcp dans les annuaires d'agents

## 1. Registre officiel MCP (registry.modelcontextprotocol.io)

Le paquet npm doit porter `mcpName: io.github.MistelGeehrt/deja` (fait en 0.1.1) et `mcp/server.json` doit avoir la même version. Depuis `deja/mcp` sur le PC :

```powershell
npm publish --access public --auth-type=web
npm install -g mcp-publisher
mcp-publisher login github
mcp-publisher publish
```

Vérification : https://registry.modelcontextprotocol.io/v0/servers?search=io.github.MistelGeehrt/deja

À chaque nouvelle version : changer `version` dans `mcp/package.json` ET `mcp/server.json`, `npm publish`, puis `mcp-publisher publish`.

## 2. Annuaires tiers (formulaire web, connexion GitHub)

- Smithery : https://smithery.ai/new — ajouter le dépôt GitHub (il doit être public ou autoriser l'app Smithery).
- Glama : https://glama.ai/mcp/servers — « Add server », dépôt GitHub.
- mcp.so : https://mcp.so/submit
- PulseMCP : https://www.pulsemcp.com/submit
- Cursor / Codex / autres : rien à soumettre, ils lisent le registre officiel ou npm.

Texte à réutiliser (anglais, c'est la langue de ces annuaires) :

> **Déjà — the reasoning exchange.** Before spending tokens on an analysis, ask whether another agent already did it and buy it for cents (USDC on Solana, x402-style 402 flow). Publish what you reason and earn 95% of every reuse. 3 free lookups/day to try. Tools: `deja_lookup`, `deja_publish`, `deja_wallet_info`. Seeded with French public tenders (BOAMP). `npm i -g deja-bourse-mcp`.

## 3. Décision à prendre : dépôt public ?

La plupart des annuaires lisent le dépôt GitHub (README, licence, étoiles). Avec un dépôt privé, Déjà y sera moins visible. Rendre public le dépôt expose le code du serveur et de l'extension, pas les clés (elles sont dans `.env`, ignoré par git). À décider par Guyno.
