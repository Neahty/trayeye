// Простой in-memory rate limit на пользователя: не более N запросов за окно.
// Для скана: 10 запросов / 10 минут.
const WINDOW_MS = 10 * 60 * 1000;
const MAX = 10;

const hits = new Map(); // userId -> [timestamps]

// Периодическая чистка протухших записей, чтобы Map не рос по «мёртвым» пользователям.
// unref() - таймер не держит процесс живым (важно для тестов/штатного завершения).
setInterval(() => {
  const now = Date.now();
  for (const [id, arr] of hits) {
    if (!arr.some((t) => now - t < WINDOW_MS)) hits.delete(id);
  }
}, WINDOW_MS).unref();

module.exports = function rateLimit(req, res, next) {
  const id = req.user?.id;
  if (!id) return next();

  const now = Date.now();
  const arr = (hits.get(id) || []).filter((t) => now - t < WINDOW_MS);
  if (arr.length >= MAX) {
    const retryAfter = Math.ceil((WINDOW_MS - (now - arr[0])) / 1000);
    res.set("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "rate_limit", retry_after: retryAfter });
  }
  arr.push(now);
  hits.set(id, arr);
  next();
};
