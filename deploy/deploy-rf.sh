#!/usr/bin/env bash
# Выкатка TrayEye на РФ-сервер (Cloud.ru). Запускать НА РФ-сервере из каталога с новым кодом:
#   sudo bash deploy/deploy-rf.sh /path/to/unpacked/repo
# Код кладётся в /opt/trayeye, .env и uploads/ сохраняются, сервис перезапускается.
set -euo pipefail

SRC="${1:?укажи каталог с кодом}"
DST=/opt/trayeye

rsync -a --delete \
  --exclude .env --exclude uploads/ --exclude node_modules/ --exclude web/dist/ --exclude .git/ \
  "$SRC"/ "$DST"/
chown -R trayeye:trayeye "$DST"
# группа trayeye (в ней user1) может править код без sudo; .env остаётся только у сервиса
chmod -R g+rwX "$DST"
find "$DST" -type d -not -path "*/node_modules/*" -exec chmod g+s {} +
chmod 600 "$DST/.env"

cd "$DST/server" && sudo -u trayeye npm ci --omit=dev --no-audit --no-fund
cd "$DST/web" && sudo -u trayeye npm ci --no-audit --no-fund && sudo -u trayeye env VITE_BASE=/trayeye/ npm run build

systemctl restart trayeye
sleep 2
curl -fsS http://127.0.0.1:4100/trayeye/api/health && echo " <- TrayEye жив"
