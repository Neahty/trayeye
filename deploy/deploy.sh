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

echo "[1/8] Забираю свежий код из GitHub..."
git fetch --all --prune
# hard reset — рабочая копия точно совпадёт с origin/master.
# Незатрекованные файлы (.env, support/.env, uploads/) НЕ трогаются.
git reset --hard "origin/$BRANCH"

echo "[2/8] Зависимости server..."
cd "$REPO_DIR/server"
npm ci --omit=dev

echo "[3/8] Зависимости support..."
cd "$REPO_DIR/support"
npm ci --omit=dev

echo "[4/8] Миграции БД..."
cd "$REPO_DIR/server"
npm run migrate

echo "[5/8] Сборка client..."
cd "$REPO_DIR/client"
npm ci
npm run build

echo "[6/8] Сборка admin..."
cd "$REPO_DIR/admin"
npm ci
npm run build

echo "[7/8] Сборка приложения для iPhone..."
# Внутри .ipa лежит только нативная оболочка, интерфейс она грузит с /app/ —
# поэтому обновления доезжают до телефона обычным деплоем, без пересборки .ipa.
#
# Кладём сборку внутрь client/dist: Caddy уже раздаёт эту папку как статику,
# так что отдельного маршрута в /etc/caddy/Caddyfile не нужно (а править его
# деплой всё равно не может — прав нет). Порядок важен: client собирается выше
# и очищает свой dist, поэтому копируем после него.
cd "$REPO_DIR/mobile/app"
npm ci
npm run build
rm -rf "$REPO_DIR/client/dist/app"
cp -r dist "$REPO_DIR/client/dist/app"

echo "[8/8] Перезапуск сервисов..."
sudo systemctl restart bytwise-api bytwise-support
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "==================================================="
echo "  Готово ✓  $(date '+%Y-%m-%d %H:%M:%S')"
echo "==================================================="
