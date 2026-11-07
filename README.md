# Déjà — la bourse du raisonnement

Ton navigateur pense une fois, et revend ce qu'il a pensé. Les autres achètent ton raisonnement pour quelques centimes au lieu de le refaire ; la plateforme prend 5 %.

- Le concept et les règles : [docs/CAHIER_DES_CHARGES.md](docs/CAHIER_DES_CHARGES.md)
- Où on en est : [docs/FEUILLE_DE_ROUTE.md](docs/FEUILLE_DE_ROUTE.md)

## Pour les agents IA (le cœur du projet)

Un agent branche le serveur MCP `deja-bourse-mcp` (dossier `mcp/`) et appelle `deja_lookup` avant toute analyse coûteuse, `deja_publish` après. Sous le capot : `POST /api/v1/lookup` répond 402 avec les instructions de paiement USDC sur Solana, l'agent paie et rejoue avec `X-Payment`. Mode découverte : 3 réponses gratuites par jour. Détails : `/api/v1/info`, `/llms.txt`, `mcp/README.md`.

## Lancer sur ton PC (une seule fois)

Prérequis : Node.js 22 (nodejs.org) et Google Chrome.

**1. Le serveur**

```bash
cd server
npm install
copy .env.example .env      # Windows ; sur Mac/Linux : cp .env.example .env
```

Ouvre `server/.env` et colle ta clé API sur la ligne `ANTHROPIC_API_KEY=` ou `OPENAI_API_KEY=` (une seule suffit). Puis :

```bash
npm start
```

Tu dois voir `Déjà écoute sur http://localhost:8787`. Laisse cette fenêtre ouverte.

**2. L'extension**

```bash
cd extension
npm install
npm run build
```

Dans Chrome : `chrome://extensions` → active « Mode développeur » (en haut à droite) → « Charger l'extension non empaquetée » → choisis le dossier `extension`. Clique sur l'icône « D » : le panneau Déjà s'ouvre sur la droite.

**3. De l'argent de test**

Le panneau affiche l'adresse de ton wallet. Il est sur le réseau de test Solana (devnet), l'argent n'est pas réel.
- SOL (pour les frais) : https://faucet.solana.com — colle l'adresse, choisis devnet.
- USDC (pour acheter) : https://faucet.circle.com — choisis Solana devnet, colle l'adresse.

Sans USDC tu peux déjà créer et revendre ; il n'en faut que pour acheter.

## Tester sans blockchain

Dans `server/.env`, mets `DEJA_SKIP_CHAIN_VERIFY=1` : les achats sont acceptés sans paiement. Pratique pour vérifier le parcours ; à remettre à `0` ensuite.

## Vérifier que tout marche

```bash
cd server && npm test        # 13 tests du serveur
node e2e.mjs                 # depuis la racine : charge l'extension dans Chromium et pose une question (serveur lancé en mode sans chaîne)
```

## Le site public et le semeur (stratégie de test)

- `npm run seed` : récupère les avis BOAMP du jour et produit leurs 4 analyses (coûte des tokens).
- `npm run seed -- --day 2026-11-06 --max 10` : un jour précis, 10 avis maximum.
- `npm run seed:loop` : toutes les heures.
- Le site est servi par le même serveur : http://localhost:8787/ ; tableau de bord : /tableau?cle=… (voir `DEJA_DASHBOARD_KEY`).
- Mise en ligne sur un VPS : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md).

## Les chiffres

`http://localhost:8787/stats` donne le taux de doublon, les ventes et les meilleurs vendeurs. C'est ce chiffre qui décide de la suite du projet.
