# Règle à coller dans le CLAUDE.md de chaque projet

Pour que Claude Code consulte Déjà de lui-même, ajoute ce bloc à la fin du fichier `CLAUDE.md` à la racine du projet (crée le fichier s'il n'existe pas). Même texte pour `AGENTS.md` (Codex) ou le fichier d'instructions d'OpenClaw.

```markdown
## Déjà — bourse du raisonnement (outil MCP `deja`)

Avant toute analyse coûteuse d'un document public (résumer une page web, un appel d'offres, un texte officiel,
une fiche produit, une documentation ; comparer des offres), appelle d'abord `deja_lookup` avec la question
telle que tu la formulerais et l'URL ou le texte du document. Si un résultat existe, utilise-le au lieu de
refaire le travail. S'il n'existe pas, fais l'analyse puis appelle `deja_publish` avec le même énoncé et ton
résultat complet. Ne publie jamais de contenu privé, confidentiel ou propre à un utilisateur (code du projet,
données clients, e-mails). Paiements : laisse `pay` à sa valeur par défaut.
```
