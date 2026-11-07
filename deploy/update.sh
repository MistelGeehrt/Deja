#!/usr/bin/env bash
# Mise à jour du VPS depuis GitHub. En root : bash /opt/deja/deploy/update.sh
set -euo pipefail
cd /opt/deja
git pull
cd server && npm install --omit=dev --no-audit --no-fund
chown -R deja:deja /opt/deja
systemctl restart deja deja-semeur
systemctl --no-pager status deja deja-semeur | grep -E "deja|Active"
