// Одноразовые коды входа для приложения на телефоне.
//
// В мини-аппе вход идёт по Telegram initData, но у установленного приложения
// (нативная сборка или иконка на «Домой») его нет. Поэтому бот по команде /pwa
// выдаёт короткий код, а приложение меняет его на обычный токен.
//
// Коды живут 15 минут и одноразовые, поэтому храним их в памяти процесса:
// таблица в БД ради такого срока жизни не нужна, а перезапуск сервера просто
// обнулит неиспользованные коды - пользователь запросит новый.
const TTL_MS = 15 * 60 * 1000;

// code -> { uid, expires }
const codes = new Map();

function sweep() {
  const now = Date.now();
  for (const [code, rec] of codes) {
    if (rec.expires <= now) codes.delete(code);
  }
}

// Шестизначный код. Коллизию (код уже занят живой записью) просто перегенерируем.
function issue(uid) {
  sweep();
  // Один пользователь - один активный код: прошлый запрос обесценивается.
  for (const [code, rec] of codes) {
    if (rec.uid === uid) codes.delete(code);
  }
  let code;
  do {
    code = String(Math.floor(100000 + Math.random() * 900000));
  } while (codes.has(code));
  codes.set(code, { uid, expires: Date.now() + TTL_MS });
  return code;
}

// Возвращает uid и сразу гасит код - второй раз им не войти.
function redeem(code) {
  sweep();
  const key = String(code || "").replace(/\D/g, "");
  const rec = codes.get(key);
  if (!rec) return null;
  codes.delete(key);
  return rec.uid;
}

// --- Заявки на доступ ---
//
// Команда /pwa доступна всем, но нигде не объявлена: о ней узнают только с экрана
// входа в самом приложении. Обычному человеку код не выдаётся сразу - заявка уходит
// админу, и код появляется только после его подтверждения.
//
// Заявки живут дольше кода: админ может ответить не сразу.
const REQUEST_TTL_MS = 24 * 60 * 60 * 1000;

// reqId -> { uid, tgId, expires }
const requests = new Map();
let seq = 0;

function sweepRequests() {
  const now = Date.now();
  for (const [id, rec] of requests) {
    if (rec.expires <= now) requests.delete(id);
  }
}

// Уже висит необработанная заявка - второй раз не создаём, чтобы человек
// не завалил админа кнопками, нажимая /pwa подряд.
function pendingFor(uid) {
  sweepRequests();
  for (const [id, rec] of requests) {
    if (rec.uid === uid) return id;
  }
  return null;
}

function requestAccess(uid, tgId) {
  sweepRequests();
  const id = String(++seq);
  requests.set(id, { uid, tgId, expires: Date.now() + REQUEST_TTL_MS });
  return id;
}

// Забирает заявку - повторное нажатие кнопки уже ничего не сделает.
function takeRequest(reqId) {
  sweepRequests();
  const rec = requests.get(String(reqId));
  if (!rec) return null;
  requests.delete(String(reqId));
  return rec;
}

module.exports = {
  issue, redeem, TTL_MS,
  requestAccess, takeRequest, pendingFor, REQUEST_TTL_MS
};
