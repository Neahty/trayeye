# TrayEye

Платформа для школьного питания: камера на линии подносов + нейросеть считают остатки,
кабинеты директора школы и комбината питания показывают списания, экономию и прогноз порций.
Исторически выросла из копии Bytwise, но к Bytwise больше не относится: живой Bytwise
(`/opt/bytwise`, systemd `bytwise-api`) - отдельный проект из репозитория Neahty/bytwise, не трогать.

## Структура

- `server/` - Express + PostgreSQL (сырой SQL через `pg`). Схема `src/db/schema.sql` применяется на старте.
  - `routes/auth.js` - вход по личной ссылке (`/api/auth/link`), `routes/director.js`, `routes/kombinat.js`.
  - `services/metrics.js` - все формулы (чистые функции), `services/overview.js` - сводка школы,
    `services/schoolData.js` - SQL, `services/vision.js` - распознавание подноса (Gemini → OpenAI).
  - `middleware/cabinetAuth.js` - JWT + проверка, что ссылка не отозвана, на каждом запросе.
  - `services/events.js` - лента уведомлений (таблица `events`): запись при действиях, `GET /notifications`.
- `web/` - React 18 + Vite, дизайн по макету Figma. `components/Topbar.jsx` - поиск (Ctrl+K), уведомления, профиль.
  - Анимации: `motion/react`, значения только из `lib/motion.js`; появление карточек/строк - CSS в `styles.css`.
    Анимируем только transform/opacity, «уменьшить движение» отключает всё.
  - `?date=` и `?focus=kind-id` в адресе: уведомления и поиск открывают нужный день и подсвечивают строку.
- `docs/PLAN-cabinets.md` - план и решения.

## Где работает

РФ-сервер Cloud.ru (`ssh rf`, vm-ce8793): `/opt/trayeye`, systemd `trayeye` (127.0.0.1:4100, пользователь trayeye),
PostgreSQL `trayeye` там же. Снаружи: https://shekspireteam.ru/trayeye/ (Caddy Лондон → туннель → Caddy РФ :8080).
Выкатка: на РФ есть клон `~/trayeye` (push/pull через deploy key, хост `github-trayeye`):
`ssh rf 'cd ~/trayeye && git pull --ff-only && sudo bash deploy/deploy-rf.sh ~/trayeye'`. Подробно: `deploy/README.md`.
`user1` на РФ в группе `trayeye` и может править `/opt/trayeye` без sudo (кроме `.env`).
С локального компа РФ доступен только через Лондон: `ssh rf` = ProxyJump `kaplun` (163.5.16.34).

## Команды

- `cd server && npm run seed` - пересоздать демо-данные (стирает БД!) и вывести ссылки входа.
- `cd server && npm run link -- kombinat 1` - выдать ссылку из консоли.
- `cd server && npm test` - юнит-тесты + тесты API на `TEST_DATABASE_URL`.
- `cd web && npm test && npm run build`.

## Правила

- Доступ: каждый запрос директора фильтруется по `req.cabinet.schoolId`, комбината - по `req.cabinet.kombinatId`.
- Ссылки входа хранятся только как sha256; сам токен показывается один раз.
- Локальный dev-сервер останавливать по PID, не `pkill -f "node src/index.js"`: так же называются боевые сервисы на сервере.
- Коммиты: `feat: ...`, `fix: ...` и т.д., описание по-русски.
