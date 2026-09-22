#!/usr/bin/env bash
#
# Bytwise - deploy script (запускается на Ubuntu-сервере).
# Вызывается GitHub Actions по SSH при каждом push в master,
# либо руками:  bash /opt/bytwise/deploy/deploy.sh
#
set -euo pipefail

REPO_DIR="/opt/bytwise"
BRANCH="master"
# Хэши lock-файлов с прошлого выката: по ним видно, менялись ли зависимости.
STATE_DIR="$REPO_DIR/.deploy-state"

echo "==================================================="
echo "  Bytwise deploy - $(date '+%Y-%m-%d %H:%M:%S')"
echo "==================================================="

# Ставим зависимости ТОЛЬКО если изменился package-lock.json.
# Раньше npm ci выполнялся на каждом выкате, а он начинает с rm -rf node_modules -
# то есть выдёргивал модули из-под живого процесса API. Всё, что подгружается лениво
# (require внутри обработчиков), падало с MODULE_NOT_FOUND в окне между установкой
# и рестартом, под живым трафиком. Обычный выкат зависимости не меняет, поэтому
# в большинстве случаев node_modules теперь вообще не трогается.
install_if_changed() {
  local dir="$1" name="$2" omit_dev="${3:-no}"
  local lock="$dir/package-lock.json"
  local stamp="$STATE_DIR/$name.sha"
  local cur
  cur="$(sha256sum "$lock" | cut -d' ' -f1)"

  if [ -f "$stamp" ] && [ "$(cat "$stamp")" = "$cur" ] && [ -d "$dir/node_modules" ]; then
    echo "  · $name: зависимости не менялись, пропускаю"
    return 0
  fi

  echo "  · $name: зависимости изменились, ставлю..."
  if [ "$omit_dev" = "yes" ]; then
    (cd "$dir" && npm ci --omit=dev)
  else
    (cd "$dir" && npm ci)
  fi
  mkdir -p "$STATE_DIR"
  echo "$cur" > "$stamp"
}

# Сборка фронта в ОТДЕЛЬНЫЙ каталог dist.new, а не поверх рабочего dist.
# Раньше vite build очищал прод-каталог перед записью: упавшая сборка (частая причина -
# OOM на маленьком VPS) оставляла сайт с пустым dist, то есть в 404 до следующего
# успешного выката. Теперь рабочий dist до последнего момента остаётся нетронутым.
build_front() {
  local dir="$1" name="$2"
  echo "  · собираю $name..."
  rm -rf "$dir/dist.new"
  (cd "$dir" && npm run build -- --outDir dist.new --emptyOutDir)
}

# Атомарная подмена: рабочий dist заменяется уже собранным dist.new одним mv.
swap_dist() {
  local dir="$1"
  rm -rf "$dir/dist.old"
  if [ -d "$dir/dist" ]; then
    mv "$dir/dist" "$dir/dist.old"
  fi
  mv "$dir/dist.new" "$dir/dist"
  rm -rf "$dir/dist.old"
}

cd "$REPO_DIR"

echo "[1/7] Забираю свежий код из GitHub..."
git fetch --all --prune
# hard reset - рабочая копия точно совпадёт с origin/master.
# Незатрекованные файлы (.env, support/.env, uploads/) НЕ трогаются.
git reset --hard "origin/$BRANCH"

echo "[2/7] Зависимости server и support..."
install_if_changed "$REPO_DIR/server"  server  yes
install_if_changed "$REPO_DIR/support" support yes

echo "[3/7] Миграции БД..."
(cd "$REPO_DIR/server" && npm run migrate)

echo "[4/7] Зависимости фронтов..."
install_if_changed "$REPO_DIR/client"     client
install_if_changed "$REPO_DIR/admin"      admin
install_if_changed "$REPO_DIR/mobile/app" mobile

echo "[5/7] Сборка фронтов (в отдельные каталоги, прод пока не трогаем)..."
build_front "$REPO_DIR/client" "client"
build_front "$REPO_DIR/admin"  "admin"
# Внутри .ipa лежит только нативная оболочка, интерфейс она грузит с /app/ -
# поэтому обновления доезжают до телефона обычным деплоем, без пересборки .ipa.
build_front "$REPO_DIR/mobile/app" "приложение для iPhone"

# Сборку приложения кладём внутрь client/dist.new: Caddy уже раздаёт эту папку как
# статику, так что отдельного маршрута в /etc/caddy/Caddyfile не нужно (а править его
# деплой всё равно не может - прав нет).
rm -rf "$REPO_DIR/client/dist.new/app"
cp -r "$REPO_DIR/mobile/app/dist.new" "$REPO_DIR/client/dist.new/app"
rm -rf "$REPO_DIR/mobile/app/dist.new"

echo "[6/7] Подменяю собранное и перезапускаю сервисы..."
# Досюда доходим, только если ВСЕ сборки прошли: set -e прервал бы скрипт раньше,
# оставив рабочие dist нетронутыми.
swap_dist "$REPO_DIR/client"
swap_dist "$REPO_DIR/admin"

sudo systemctl restart bytwise-api bytwise-support
sudo systemctl reload caddy || sudo systemctl restart caddy

echo "[7/7] Проверяю, что API действительно поднялся..."
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
  echo "  ✗ API не отвечает на $HEALTH_URL спустя 30 секунд - выкат считаю неудачным."
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
