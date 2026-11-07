# Mettre Déjà en ligne sur un VPS

Prérequis : un VPS Ubuntu ou Debian avec un accès root, et un sous-domaine (ex. `deja.mistelgeehrt.com`) dont l'enregistrement DNS **A** pointe vers l'adresse IP du VPS.

Tout se fait en root, dans une session SSH. Chaque bloc se colle tel quel.

## 1. Autoriser le VPS à lire le dépôt GitHub (privé)

```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/id_ed25519 -C "vps-deja" <<< y >/dev/null; cat /root/.ssh/id_ed25519.pub
```

Copie la ligne affichée (commence par `ssh-ed25519`). Sur GitHub : dépôt `deja` → Settings → Deploy keys → Add deploy key → colle, nom « VPS », sans l'écriture. Puis :

```bash
ssh-keyscan github.com >> /root/.ssh/known_hosts 2>/dev/null; ssh -T git@github.com 2>&1 | head -1
```

Attendu : `Hi MistelGeehrt/deja! You've successfully authenticated…`

## 2. Installer

> Le VPS de MistelGeehrt a déjà nginx (Contentflow, Paluxi, Super-Agent…). Le script le détecte : il n'installe pas Caddy et ajoute un site nginx + certificat certbot à la place. C'est ce qui a été fait le 7 novembre 2026.


```bash
git clone git@github.com:MistelGeehrt/deja.git /opt/deja
bash /opt/deja/deploy/install.sh deja.mistelgeehrt.com
```

(Remplace le sous-domaine.) Le script installe Node 22, Caddy, le code dans `/opt/deja`, et crée deux services : `deja` (le site) et `deja-semeur` (le semeur horaire).

## 3. Régler

```bash
nano /opt/deja/server/.env
```

À remplir : `OPENAI_API_KEY` ou `ANTHROPIC_API_KEY`, `DEJA_PLATFORM_WALLET`, `DEJA_DASHBOARD_KEY` (un mot de passe de ton choix). Laisse `DEJA_SKIP_CHAIN_VERIFY=0`. Ctrl+O, Entrée, Ctrl+X. Puis :

```bash
systemctl restart deja deja-semeur && sleep 3 && systemctl --no-pager status deja deja-semeur | grep Active
```

Attendu : deux lignes `Active: active (running)`.

## 4. Vérifier

- `https://deja.mistelgeehrt.com` affiche la page d'accueil (vide au début).
- `journalctl -u deja-semeur -f` montre le semeur travailler (avis d'aujourd'hui et d'hier, toutes les heures).
- Pour un jour précis : `cd /opt/deja/server && sudo -u deja npm run seed -- --day 2026-11-06 --max 20`
- `https://deja.mistelgeehrt.com/tableau?cle=TON_MOT_DE_PASSE` : le tableau de bord.

## 5. Mettre à jour plus tard

```bash
bash /opt/deja/deploy/update.sh
```

## 6. Google

Dans Google Search Console, ajoute la propriété `deja.mistelgeehrt.com` et soumets `https://deja.mistelgeehrt.com/sitemap.xml`. L'indexation prend de quelques jours à quelques semaines.
