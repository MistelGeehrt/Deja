# Déjà — cahier des charges

*La bourse du raisonnement. Version 1.2 du 7 novembre 2026.*

## 1. L'idée en une phrase

Chaque jour, des millions d'agents IA refont le même travail coûteux. Déjà est un marché où le premier agent qui a « pensé » une tâche est payé à chaque fois qu'un autre la réutilise, au lieu que celui-ci la recalcule.

## 2. Ce que ça fait pour l'utilisateur

- Il installe une extension Chrome. Elle contient un agent IA et un wallet Solana créé sur place.
- Sur n'importe quelle page, il formule une demande (« résume ce dossier », « compare ces devis », « que dit ce contrat sur la résiliation ? »).
- L'extension interroge d'abord la bourse :
  - **Quelqu'un a déjà fait ce raisonnement** → on lui propose de l'acheter pour quelques centimes (0,10 USDC au départ) au lieu de le refaire. Plus rapide, moins cher.
  - **Personne ne l'a fait** → l'agent le produit, le lui donne, et le met automatiquement en vente. Chaque réutilisation par quelqu'un d'autre lui rapporte 95 % du prix.
- Le paiement se fait de machine à machine, sans validation humaine, en USDC sur Solana.
- La plateforme (MistelGeehrt) prélève 5 % sur chaque échange. C'est le modèle économique.

## 3. Ce que ça ne fait PAS (version 1)

- Pas de correspondance « intelligente » entre deux formulations différentes : même demande + même page = même empreinte, point. La correspondance sémantique est prévue en version 2.
- Pas de programme Solana sur mesure : les paiements sont des virements USDC ordinaires, avec la preuve inscrite dans la transaction (memo). Le contrat on-chain viendra quand les chiffres le justifieront.
- Pas d'argent réel : réseau de test (devnet) uniquement.
- Pas de contestation d'une réponse fausse : le système de caution (le vendeur bloque des fonds, les perd si sa réponse est prouvée fausse) est en version 2.
- Pas de navigateur Chromium complet. L'extension fait 90 % du concept pour 5 % de l'effort ; le navigateur se justifiera seulement si l'extension prouve qu'il y a des acheteurs.

## 4. Les pièces

| Pièce | Rôle | Technologie |
|---|---|---|
| `extension/` | Interface utilisateur, lecture de la page, wallet, paiement | Chrome Manifest V3, TypeScript, @solana/web3.js |
| `server/` | La bourse : empreintes, résultats, devis, vérification des paiements, statistiques | Node.js, Fastify, SQLite |
| Solana devnet | Règlement en USDC + preuve (memo) | Virements SPL, memo |
| Anthropic ou OpenAI | Le cerveau de l'agent | API (clé dans `server/.env`) |

## 5. Le parcours, pas à pas

1. L'extension lit le texte de l'onglet actif et la demande de l'utilisateur.
2. Elle envoie les deux au serveur avec l'adresse du wallet.
3. Le serveur calcule l'**empreinte** : demande normalisée (casse, accents, ponctuation ignorées) + adresse de la page nettoyée (paramètres de suivi retirés) + texte de la page.
4. Si l'empreinte existe :
   - et que le demandeur en est le créateur ou l'a déjà achetée → résultat livré gratuitement ;
   - sinon → **devis** (prix, vendeur, part vendeur, commission, aperçu des 160 premiers caractères).
5. Si elle n'existe pas → l'agent produit le résultat, le serveur l'enregistre au nom du demandeur, le livre, et l'événement est compté comme un « raté » (miss).
6. Achat : l'extension construit une seule transaction Solana contenant le virement au vendeur, la commission à la plateforme et le memo `deja:<empreinte>`. Elle envoie la signature au serveur.
7. Le serveur relit la transaction sur la chaîne et vérifie : l'acheteur a signé, le vendeur a reçu sa part, la plateforme a reçu la sienne, le memo correspond, la signature n'a jamais servi. Alors seulement il livre le résultat.

## 6. L'indicateur qui décide de tout

Le **taux de doublon** : part des demandes pour lesquelles un raisonnement existait déjà. Il est calculé en continu (`GET /stats`).

- Sous 5 % : le marché ne peut pas vivre, on arrête ou on change d'angle.
- Entre 5 et 20 % : viable si le volume est très grand.
- Au-dessus de 20 % : on passe à la version 2.

Tant que ce chiffre n'est pas mesuré sur de vraies demandes, toute projection de revenu est de la fiction.

## 7. Règles d'argent

- Prix par défaut : 0,10 USDC (réglable par le serveur).
- Commission : 5 % (500 points de base), réglable.
- Le créateur ne paie jamais pour relire son propre raisonnement. L'acheteur ne paie qu'une fois par raisonnement.
- Les clés secrètes ne quittent jamais le navigateur. Le serveur ne voit que des adresses publiques et des signatures.

## 8. Risques connus

- **Réponses fausses revendues mille fois** : la caution (v2) et la contestation sont la seule parade sérieuse.
- **Œuf et poule** : sans vendeurs, pas d'acheteurs. Le premier gros fournisseur de raisonnements sera MistelGeehrt lui-même.
- **Vie privée** : un raisonnement sur une page privée (intranet, compte client) ne doit pas être mis en vente. Règle v1 : l'extension ne lit que les pages `http(s)`. Règle v2 : liste de domaines exclus + opt-out par demande.
- **Contenu de la page comme empreinte** : deux visiteurs d'une page dynamique (pub, date du jour) n'auront pas la même empreinte. À mesurer ; sinon empreinte sur le contenu principal seulement.

## 9. Version 1.1 — la stratégie de test (7 novembre 2026)

On ne peut pas automatiser la demande : des robots qui posent les mêmes questions mesureraient ce qu'on a programmé. On automatise donc tout le reste.

**Terrain choisi : les marchés publics français (BOAMP).** Avis publiés en open data (API officielle DILA, licence ouverte), des centaines par jour, lus par des entreprises qui se posent toutes les mêmes questions.

**Le semeur** (`server/src/seeder.ts`) tourne toutes les heures : nouveaux avis → 4 analyses standard chacun, mises en vente au nom du wallet de la plateforme. Coût estimé : ~1 € par jour de tokens pour 500 avis.

**Le site public** (`server/src/web.ts`) : une page par avis, indexable par Google, avec les 4 analyses derrière une « porte » et un champ de question libre. Première question d'un visiteur : réponse offerte et mise en vente à son nom. Question déjà posée : devis. C'est Google qui amène les testeurs, pas le bouche-à-oreille.

**La porte factice** : le bouton « Débloquer pour 0,10 € » enregistre l'intention de payer puis offre la réponse (bêta annoncée). On mesure l'envie de payer sans imposer un wallet à des inconnus. L'extension et Solana restent le produit final, pas l'instrument de mesure.

**Les quasi-doublons** : chaque question est comparée par le sens (embeddings) à celles déjà résolues sur le même avis ; une correspondance au-dessus du seuil compte comme « quasi-doublon » et renvoie le raisonnement existant. C'est le chiffre que la v1 ratait.

**Grille de décision après 6 semaines** (tableau de bord `/tableau`) :
- moins de 200 questions posées par des inconnus → terrain ou acquisition inadaptés, on change une fois ;
- plus de 200 questions et moins de 5 % de clics « payer » sur les devis → personne ne veut payer, on arrête ;
- plus de 15 % de clics → brancher le vrai paiement, étape 3.

## 10. Version 1.2 — retour à l'idée de départ : des agents qui achètent à des agents

La v1.1 mesurait des humains sur un site ; c'était une idée voisine, pas l'idée. Le canal des agents est un outil qu'ils branchent.

**API agents** (`server/src/api.ts`), paiement machine à machine façon x402 :
1. `POST /api/v1/lookup` avec la question et le document → `200` (résultat) si gratuit ou déjà possédé, `404` si personne ne l'a pensé (invitation à publier), `402` avec les instructions de paiement sinon ;
2. l'agent paie en USDC sur Solana (part vendeur + commission + memo = empreinte, une seule transaction) et rejoue avec `X-Payment: <signature>` ;
3. le serveur vérifie sur la chaîne et livre.
`POST /api/v1/publish` met en vente ce que l'agent a pensé lui-même. Identité : en-tête `X-Agent-Id`.

**Mode découverte** : `DEJA_FREE_PER_DAY` réponses gratuites par jour et par agent (3 par défaut), puis 402. On mesure ainsi des agents sans wallet et le moment où ils en prennent un.

**Serveur MCP `deja-mcp`** (`mcp/`), publié sur npm : outils `deja_lookup`, `deja_publish`, `deja_wallet_info`. Paie seul quand un wallet est configuré. Une ligne pour l'installer dans Claude Code, Cursor, Codex, OpenClaw.

**Diffusion automatisable** : npm + annuaires MCP ; `/llms.txt` et `/api/v1/info` pour les agents qui tombent sur le site ; le semeur garantit des réponses dès le premier agent. Le site reste une vitrine.

**Grille de décision agents** (tableau de bord) : moins de 20 agents distincts → pas concluant, diffuser davantage ; 30 paiements demandés et moins de 5 % payés → les agents ne paient pas, on arrête ; plus de 15 % payés → brancher le programme Solana et le mainnet (étape 3).
