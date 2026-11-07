#!/usr/bin/env bash
# Installation de Déjà sur un VPS Ubuntu/Debian. À lancer en root : bash install.sh deja.mondomaine.fr
set -euo pipefail
DOMAIN="${1:?Usage: bash install.sh <sous-domaine>}"
REPO="${REPO:-git@github.com:MistelGeehrt/deja.git}"

echo "== 1/6 Node.js 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 22 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node -v

echo "== 2/6 Caddy (HTTPS automatique)"
if ! command -v caddy >/dev/null; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

echo "== 3/6 Utilisateur et code"
id -u deja >/dev/null 2>&1 || useradd -r -m -d /opt/deja -s /usr/sbin/nologin deja
if [ -d /opt/deja/.git ]; then
  git -C /opt/deja pull
else
  rm -rf /opt/deja/* /opt/deja/.[!.]* 2>/dev/null || true
  git clone "$REPO" /opt/deja
fi
cd /opt/deja/server
npm install --omit=dev --no-audit --no-fund
[ -f .env ] || cp .env.example .env
sed -i "s#^DEJA_PUBLIC_URL=.*#DEJA_PUBLIC_URL=https://$DOMAIN#" .env
chown -R deja:deja /opt/deja

echo "== 4/6 Services"
cp /opt/deja/deploy/deja.service /opt/deja/deploy/deja-semeur.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable deja deja-semeur

echo "== 5/6 Caddy"
sed "s#deja.mistelgeehrt.com#$DOMAIN#" /opt/deja/deploy/Caddyfile > /etc/caddy/Caddyfile
systemctl restart caddy

echo "== 6/6 Terminé"
echo "Reste à faire : éditer /opt/deja/server/.env (clé API, wallet, mot de passe du tableau),"
echo "puis : systemctl restart deja deja-semeur"
echo "Site : https://$DOMAIN   Tableau : https://$DOMAIN/tableau?cle=..."
