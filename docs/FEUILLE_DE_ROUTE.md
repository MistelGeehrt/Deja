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

## Étape 2 — Mesurer le taux de doublon (le vrai test du projet)
- [ ] Page de statistiques lisible (taux de doublon, ventes, meilleurs vendeurs)
- [ ] Journal anonymisé des demandes pour étudier les quasi-doublons (même tâche, formulation différente)
- [ ] (toi) Utiliser Déjà tous les jours pendant 2 à 4 semaines, et faire utiliser à 3-5 personnes
- [ ] Décision : taux de doublon < 5 % → changer d'angle ; > 20 % → étape 3

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
