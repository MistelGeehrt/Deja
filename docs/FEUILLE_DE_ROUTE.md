# Déjà — feuille de route

Coche au fur et à mesure. Les cases « (toi) » sont les gestes manuels de Guyno ; les autres sont faites par l'agent.

## Étape 0 — Décider (fait)
- [x] Idée, modèle économique, arithmétique des revenus
- [x] Choix Solana + extension avant navigateur
- [x] Cahier des charges

## Étape 1 — Prototype qui tourne sur ton PC
- [x] Serveur : empreinte, devis, création, achat, vérification Solana, statistiques (13 tests)
- [x] Extension : panneau latéral, wallet local, lecture de page, paiement USDC + memo
- [x] Test de bout en bout en Chromium sans chaîne (mode `DEJA_SKIP_CHAIN_VERIFY=1`)
- [x] Dépôt GitHub `MistelGeehrt/Deja` (toi) et code poussé
- [x] (toi) Installer Node.js 22 et lancer le serveur en local — voir README
- [x] (toi) Coller la clé API dans `server/.env`
- [x] (toi) Charger l'extension dans Chrome (chrome://extensions → mode développeur → « Charger l'extension non empaquetée » → dossier `extension`)
- [x] (toi) Première demande sur une vraie page, avec une vraie réponse d'IA
- [x] (toi) Alimenter le wallet de l'extension : SOL de test sur faucet.solana.com, USDC de test sur faucet.circle.com (réseau Solana devnet)
- [x] (toi) Créer un second wallet (second profil Chrome) et acheter un raisonnement du premier : premier paiement réel sur devnet, vérifié par le serveur
- [x] Premier achat réel vérifié sur devnet le 4 novembre 2026 (acheteur −0,10 ; vendeur/plateforme +0,10)
- [ ] Afficher la mise en forme des réponses (gras, titres) au lieu des `**` bruts
- [ ] Corriger ce que les prochains tests révéleront

## Étape 2 — Mesurer, automatiquement (stratégie v1.1)
- [x] Semeur BOAMP : nouveaux avis → 4 analyses standard, en vente au nom de la plateforme
- [x] Site public : une page par avis, question libre, porte « Débloquer 0,10 € » qui mesure l'intention de payer
- [x] Quasi-doublons comptés par le sens (embeddings) ; mise en forme des réponses (gras, listes)
- [x] Tableau de bord `/tableau` avec la grille de décision intégrée ; sitemap et robots pour Google
- [x] Kit de déploiement VPS (install.sh, services, Caddy HTTPS)
- [x] API agents : lookup / 402 / X-Payment / publish, quota gratuit, stats agents (v1.2)
- [x] Serveur MCP `deja-bourse-mcp` (lookup, publish, wallet) testé entre deux agents
- [x] `/llms.txt` et `/api/v1/info` pour les agents qui arrivent par le site
- [x] (toi) En ligne le 7 novembre 2026 sur https://deja.mistelgeehrt.com (nginx + certbot, semeur horaire, API agents vérifiée en production)
- [x] (toi) `deja-bourse-mcp@0.1.0` publié sur npm le 7 novembre 2026
- [x] (toi) Registre officiel MCP : `io.github.MistelGeehrt/deja` v0.1.2 publié le 9 novembre 2026
- [x] (toi) Glama : fiche revendiquée, test de construction réussi, release publiée, score 83 % (14 novembre 2026)
- [x] Smithery : fermé aux inscriptions (racheté par Arcade, comptes coupés le 31 octobre 2026) ; PulseMCP : importe le registre officiel, rien à faire
- [ ] mcp.so : soumission payante (39 $), reportée le 14 novembre 2026 ; à reconsidérer si les agents arrivent
- [x] (toi) Dépôt GitHub rendu public (licence MIT)
- [x] (toi) Claude Code branché sur deja-bourse-mcp le 7 novembre 2026 : première réponse obtenue par un agent via le paquet npm (installer globalement : `npm i -g deja-bourse-mcp`, `npx` dépasse les 30 s de délai MCP sur connexion lente)
- [x] (toi) Premier paiement 402 réel entre machines le 9 novembre 2026 : l'agent Claude Code de Guyno a payé 0,10 USDC sur devnet, vérifié par le serveur, livré
- [x] Règle CLAUDE.md rédigée (docs/REGLE-CLAUDE-MD.md) et posée dans le CLAUDE.md global de Guyno
- [ ] (toi) Déclarer le site dans Google Search Console (sitemap) pour accélérer l'indexation
- [ ] (toi) Regarder le tableau de bord une fois par semaine, 6 semaines, sans rien changer
- [ ] Décision agents : < 20 agents distincts → diffuser plus ; 30 paiements demandés et < 5 % payés → arrêter ; > 15 % payés → étape 3
- [ ] (vitrine humaine, secondaire) < 200 questions → changer de terrain une fois ; < 5 % de clics payer → ignorer ce canal

## Étape 3 — Ouvrir à d'autres
- [ ] (toi) Héberger le serveur sur le VPS (HTTPS, nom de domaine)
- [ ] Correspondance sémantique : deux formulations de la même tâche → même raisonnement
- [ ] Empreinte sur le contenu principal de la page (ignorer pubs, dates, menus)
- [ ] Liste de domaines exclus + opt-out par demande (vie privée)
- [ ] Prix libre par vendeur ; prix dégressif avec le nombre de réutilisations
- [ ] Page « Mes gains » dans l'extension
- [ ] Publication sur le Chrome Web Store (toi : compte développeur, 5 $ une fois)

## Étape 4 — Rendre le marché digne de confiance
- [ ] Programme Solana sur mesure : registre des empreintes, règlement atomique, commission prélevée par le contrat
- [ ] Caution du vendeur et contestation d'une réponse fausse
- [ ] Attestation « produit dans Déjà » (preuve d'origine)
- [ ] Passage en mainnet avec de vrais USDC (toi : décision + conformité)

## Étape 5 — Au-delà de Chrome
- [ ] API ouverte pour que d'autres agents (hors navigateur) achètent et vendent
- [ ] Navigateur « habillé » autour de Chromium, seulement si l'extension a prouvé la demande
