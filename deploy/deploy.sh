#!/usr/bin/env bash
#
# Bytwise — deploy script (запускается на Ubuntu-сервере).
# Вызывается GitHub Actions по SSH при каждом push в master,
# либо руками:  bash /opt/bytwise/deploy/deploy.sh
#
set -euo pipefail

REPO_DIR="/opt/bytwise"
BRANCH="master"

echo "==================================================="
echo "  Bytwise deploy — $(date '+%Y-%m-%d %H:%M:%S')"
echo "==================================================="

cd "$REPO_DIR"

echo "[1/7] Забираю свежий код из GitHub..."
git fetch --all --prune
# hard reset — рабочая копия точно совпадёт с origin/master.
# Незатрекованные файлы (.env, support/.env, uploads/) НЕ трогаются.
git reset --hard "origin/$BRANCH"

echo "[2/7] Зависимости server..."
cd "$REPO_DIR/server"
npm ci --omit=dev

echo "[3/7] Зависимости support..."
cd "$REPO_DIR/support"
npm ci --omit=dev

echo "[4/7] Миграции БД..."
cd "$REPO_DIR/server"
npm run migrate

echo "[5/7] Сборка client..."
cd "$REPO_DIR/client"
npm ci
npm run build

echo "[6/7] Сборка admin..."
cd "$REPO_DIR/admin"
npm ci
npm run build

echo "[7/7] Перезапуск сервисов..."
sudo systemctl restart bytwise-api bytwise-support
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "==================================================="
echo "  Готово ✓  $(date '+%Y-%m-%d %H:%M:%S')"
echo "==================================================="
