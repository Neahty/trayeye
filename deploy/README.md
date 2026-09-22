# Bytwise - перенос на Ubuntu 24.04 + авто-деплой

Схема работы после настройки:

```
меняешь код на Windows  →  git push  →  GitHub Actions  →  SSH на сервер
                                                              → deploy.sh
                                                                 (pull, сборка,
                                                                  миграции, restart)
```

Один раз настраиваешь сервер по этой инструкции. Дальше - только `git push`, и через ~1 минуту сервер обновлён.

---

## Что где лежит

| Компонент | На сервере |
|---|---|
| Код (git-клон) | `/opt/bytwise` |
| API + основной бот | systemd-сервис `bytwise-api` (порт 4000) |
| Бот поддержки | systemd-сервис `bytwise-support` |
| Реверс-прокси + статика | Caddy (`/etc/caddy/Caddyfile`) |
| База | нативный PostgreSQL, БД `calorieyka`, роль `calorie` |
| Секреты | `/opt/bytwise/.env` и `/opt/bytwise/support/.env` (НЕ в git) |
| Загруженные фото | `/opt/bytwise/server/uploads/` (НЕ в git, переживает деплои) |

---

## Часть 1. Первичная настройка сервера (один раз)

Всё выполняется на сервере под `root` или через `sudo`.

### 1.1. Базовые пакеты

```bash
apt update && apt upgrade -y
apt install -y git curl ufw
```

### 1.2. Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
node -v   # должно быть v20.x
```

### 1.3. PostgreSQL

```bash
apt install -y postgresql postgresql-contrib
systemctl enable --now postgresql

# Роль и база (пароль совпадает с DATABASE_URL в .env)
sudo -u postgres psql -c "CREATE ROLE calorie LOGIN PASSWORD 'calorie';"
sudo -u postgres psql -c "CREATE DATABASE calorieyka OWNER calorie;"
```

> Пароль `calorie` - как в текущем `start.bat`. Хочешь надёжнее - поменяй здесь и в `DATABASE_URL`.

### 1.4. Caddy

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

### 1.5. Пользователь для приложения

```bash
adduser --system --group --home /opt/bytwise bytwise
```

### 1.6. Клонируем репозиторий

```bash
cd /opt
git clone https://github.com/<ТВОЙ_ЮЗЕР>/<ТВОЙ_РЕПО>.git bytwise
chown -R bytwise:bytwise /opt/bytwise
```

> Если репозиторий приватный - настрой deploy key (см. Часть 3, там же ключ для Actions пригодится) или клонируй по HTTPS с токеном.

### 1.7. Секреты (.env)

```bash
# корневой .env (API + основной бот)
cp /opt/bytwise/.env.example /opt/bytwise/.env
nano /opt/bytwise/.env        # вставь реальные значения

# .env бота поддержки
cp /opt/bytwise/support/.env.example /opt/bytwise/support/.env
nano /opt/bytwise/support/.env

chown bytwise:bytwise /opt/bytwise/.env /opt/bytwise/support/.env
chmod 600 /opt/bytwise/.env /opt/bytwise/support/.env
```

> Значения возьми из `.env` на Windows (там уже всё заполнено). **Не коммить их в git.**

### 1.8. systemd-сервисы

```bash
cp /opt/bytwise/deploy/bytwise-api.service     /etc/systemd/system/
cp /opt/bytwise/deploy/bytwise-support.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable bytwise-api bytwise-support
```

### 1.9. Caddy-конфиг

```bash
cp /opt/bytwise/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy
```

> DNS-запись `shekspireteam.ru` (A-запись) должна указывать на IP этого сервера - Caddy сам выпустит HTTPS-сертификат.

### 1.10. Право деплой-скрипта на restart без пароля

`deploy.sh` перезапускает сервисы через `sudo`. Даём пользователю, под которым заходит Actions (например `deploy`), точечное право без пароля:

```bash
# создаём deploy-пользователя, если его нет
adduser --disabled-password --gecos "" deploy
usermod -aG bytwise deploy

# точечный sudo без пароля - только на нужные команды
cat >/etc/sudoers.d/bytwise-deploy <<'EOF'
deploy ALL=(root) NOPASSWD: /bin/systemctl restart bytwise-api, /bin/systemctl restart bytwise-support, /bin/systemctl restart bytwise-api bytwise-support, /bin/systemctl reload caddy, /bin/systemctl restart caddy
EOF
chmod 440 /etc/sudoers.d/bytwise-deploy
```

Дай `deploy` доступ к рабочей папке:

```bash
chown -R bytwise:bytwise /opt/bytwise
chmod -R g+w /opt/bytwise
```

### 1.11. Первый ручной запуск/деплой

```bash
sudo -u deploy bash /opt/bytwise/deploy/deploy.sh
```

Скрипт соберёт фронты, накатит миграции и запустит сервисы. Проверка:

```bash
systemctl status bytwise-api bytwise-support --no-pager
curl -s http://localhost:4000/api/health
journalctl -u bytwise-api -n 50 --no-pager
```

Открой `https://shekspireteam.ru` - должно работать.

### 1.12. Фаервол (по желанию)

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

---

## Часть 2. Настройка авто-деплоя (GitHub Actions)

### 2.1. SSH-ключ для Actions

На **своём компьютере** (или на сервере) сгенерь пару ключей *без пароля*:

```bash
ssh-keygen -t ed25519 -C "github-actions-bytwise" -f bytwise_deploy_key
```

Публичный ключ добавь на сервер пользователю `deploy`:

```bash
# на сервере
mkdir -p /home/deploy/.ssh
nano /home/deploy/.ssh/authorized_keys   # вставь содержимое bytwise_deploy_key.pub
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
```

### 2.2. Секреты в GitHub

Репозиторий → **Settings → Secrets and variables → Actions → New repository secret**. Добавь четыре:

| Имя | Значение |
|---|---|
| `SERVER_HOST` | IP или домен сервера |
| `SERVER_USER` | `deploy` |
| `SERVER_PORT` | `22` |
| `SERVER_SSH_KEY` | всё содержимое приватного ключа `bytwise_deploy_key` (не .pub) |

### 2.3. Готово

Workflow `.github/workflows/deploy.yml` уже в репозитории. Теперь любой `git push` в `master` автоматически задеплоит. Прогресс - во вкладке **Actions**. Можно запустить и вручную: Actions → *Deploy to Ubuntu* → **Run workflow**.

---

## Часть 3. Ежедневная работа

```bash
# на Windows
git add .
git commit -m "правка"
git push
```

Через ~1 минуту сервер обновлён. Смотреть, что происходит, - во вкладке **Actions** на GitHub.

### Полезные команды на сервере

```bash
# логи в реальном времени
journalctl -u bytwise-api -f
journalctl -u bytwise-support -f

# перезапуск руками
sudo systemctl restart bytwise-api

# деплой руками (если Actions недоступны)
bash /opt/bytwise/deploy/deploy.sh
```

---

## Частые вопросы

**Загруженные фото не потеряются при деплое?**
Нет. `deploy.sh` делает `git reset --hard`, который не трогает незатрекованные файлы. `uploads/` и `.env` в `.gitignore` - они остаются на месте.

**Как откатиться на прошлую версию?**
```bash
cd /opt/bytwise
git reset --hard <хеш_старого_коммита>
bash deploy/deploy.sh
```

**Миграция упала - что будет?**
`deploy.sh` остановится на шаге миграции (`set -e`), сервисы НЕ перезапустятся со сломанной схемой. Старая версия продолжит работать. Смотри лог в Actions, чини, пушь снова.

**Нужен ли Docker?**
Нет. Выбран нативный запуск через systemd - легче в отладке и меньше накладных расходов. Dockerfile'ы в `server/` и `client/` можно оставить как есть, они не мешают.
