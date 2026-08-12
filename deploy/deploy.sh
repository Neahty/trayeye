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

echo "[1/9] Забираю свежий код из GitHub..."
git fetch --all --prune
# hard reset — рабочая копия точно совпадёт с origin/master.
# Незатрекованные файлы (.env, support/.env, uploads/) НЕ трогаются.
git reset --hard "origin/$BRANCH"

echo "[2/9] Зависимости server..."
cd "$REPO_DIR/server"
npm ci --omit=dev

echo "[3/9] Зависимости support..."
cd "$REPO_DIR/support"
npm ci --omit=dev

echo "[4/9] Миграции БД..."
cd "$REPO_DIR/server"
npm run migrate

echo "[5/9] Сборка client..."
cd "$REPO_DIR/client"
npm ci
npm run build

echo "[6/9] Сборка admin..."
cd "$REPO_DIR/admin"
npm ci
npm run build

echo "[7/9] Сборка приложения для iPhone..."
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

echo "[8/9] Перезапуск сервисов..."
sudo systemctl restart bytwise-api bytwise-support
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "[9/9] Проверяю, что API действительно поднялся..."
# Без этой проверки деплой печатал «Готово ✓» и красил сборку в зелёный даже тогда,
# когда сервис падал на старте и systemd крутил его в крэш-лупе: о поломке узнавали
# от пользователей. Теперь неудачный выкат виден сразу в логе GitHub Actions.
HEALTH_URL="http://127.0.0.1:${PORT:-4000}/api/health"
API_UP=""
for _ in $(seq 1 15); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    API_UP="1"
    break
  fi
  sleep 2
done

if [ -z "$API_UP" ]; then
  echo "  ✗ API не отвечает на $HEALTH_URL спустя 30 секунд — выкат считаю неудачным."
  echo "  --- состояние сервиса ---"
  sudo systemctl status bytwise-api --no-pager -l | tail -n 20 || true
  echo "  --- последние строки журнала ---"
  sudo journalctl -u bytwise-api -n 50 --no-pager || true
  exit 1
fi
echo "  API отвечает ✓"

echo "==================================================="
echo "  Готово ✓  $(date '+%Y-%m-%d %H:%M:%S')"
echo "==================================================="
