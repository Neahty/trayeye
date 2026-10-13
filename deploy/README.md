# Деплой TrayEye

Приложение живёт на **РФ-сервере (Cloud.ru, vm-ce8793)**: Node-сервис, PostgreSQL и собранный `web/`.
Наружу оно открыто через лондонский сервер: `https://shekspireteam.ru/trayeye/` → WireGuard → РФ.

```
браузер → shekspireteam.ru (Caddy, Лондон, HTTPS)
        → 10.77.88.2:8080 (Caddy на РФ, только по туннелю)
        → 127.0.0.1:4100 (trayeye.service, префикс /trayeye сохраняется)
        → PostgreSQL trayeye (localhost)
```

## Файлы

| Файл | Куда |
| --- | --- |
| `trayeye.service` | `/etc/systemd/system/trayeye.service` на РФ |
| `deploy-rf.sh` | выкатка нового кода на РФ |

## Caddy

РФ, `/etc/caddy/Caddyfile`, блок `:8080` - именно `handle`, не `handle_path`: префикс нужен приложению.

```
handle /trayeye/* {
    reverse_proxy 127.0.0.1:4100 {
        trusted_proxies 10.77.88.1/32
    }
}
```

Лондон, блок `shekspireteam.ru`, до общего `handle`:

```
redir /trayeye /trayeye/ 308
handle /trayeye/* {
    reverse_proxy 10.77.88.2:8080
}
```

## .env на РФ (`/opt/trayeye/.env`, права 600, владелец trayeye)

```
DATABASE_URL=postgresql://trayeye:<пароль>@localhost:5432/trayeye
JWT_SECRET=<openssl rand -hex 32>
PORT=4100
BASE_PATH=/trayeye
PUBLIC_URL=https://shekspireteam.ru/trayeye
APP_TZ=Europe/Moscow
```

Ключ Gemini с российского IP не работает: для распознавания нужен `OPENAI_API_KEY` или прокси через Лондон
(`/etc/cloud-vpn/proxy.env`, см. SERVER_READY.md на РФ).

## Демо-данные

```bash
cd /opt/trayeye/server && sudo -u trayeye NODE_ENV=production SEED_FORCE=1 npm run seed
```
Seed стирает базу и печатает ссылки входа для комбината и директоров.
