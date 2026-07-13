// Защита админ-роутов: отдельный admin-JWT + проверка is_admin + не заблокирован + IP-allowlist.
const db = require("../db");
const { verifyAdmin, signAdmin } = require("../utils/jwt");
const {
  ADMIN_SESSION_COOKIE,
  setAdminSession,
  shouldRefreshAdminSession
} = require("../utils/adminSession");

function getAllowlist() {
  return (process.env.ADMIN_IP_ALLOWLIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function clientIp(req) {
  // НЕ парсим X-Forwarded-For вручную: Caddy дописывает реальный IP ПОСЛЕ клиентского XFF,
  // поэтому первый элемент подделываем (обход IP-allowlist/rate-limit). При trust proxy:1
  // Express сам отдаёт корректный клиентский IP в req.ip.
  return req.ip || req.connection?.remoteAddress || "";
}

module.exports = async function adminAuth(req, res, next) {
  try {
    // IP allowlist (если задан)
    const allow = getAllowlist();
    if (allow.length) {
      const ip = clientIp(req);
      const ok = allow.some((a) => ip === a || ip.endsWith(a));
      if (!ok) return res.status(403).json({ error: "ip_not_allowed" });
    }

    const header = req.headers.authorization || "";
    const bearerToken = header.startsWith("Bearer ") ? header.slice(7) : null;
    const cookieToken = req.cookies?.[ADMIN_SESSION_COOKIE] || null;
    const tokens = [
      { token: cookieToken, source: "cookie" },
      { token: bearerToken, source: "bearer" }
    ].filter((t) => t.token);
    if (!tokens.length) return res.status(401).json({ error: "no_token" });

    let decoded;
    let source;
    for (const candidate of tokens) {
      try {
        decoded = verifyAdmin(candidate.token);
        source = candidate.source;
        break;
      } catch {
        // Try the fallback token before rejecting old tabs with a stale cookie.
      }
    }
    if (!decoded) return res.status(401).json({ error: "invalid_token" });

    const { rows } = await db.query(
      "SELECT id, telegram_id, username, name, is_admin, is_blocked FROM users WHERE id = $1",
      [decoded.uid]
    );
    const user = rows[0];
    if (!user || !user.is_admin) return res.status(403).json({ error: "admin_only" });
    if (user.is_blocked) return res.status(403).json({ error: "blocked" });

    // «Скользящая» сессия: если до истечения токена осталось меньше половины срока (< 6 ч),
    // выпускаем свежий и отдаём в заголовке X-Admin-Token. Клиент его сохраняет → активного
    // админа не выкидывает, при этом простаивающая сессия всё равно истечёт.
    if (shouldRefreshAdminSession(decoded) || source === "bearer") {
      const fresh = setAdminSession(res, { uid: user.id });
      res.set("X-Admin-Token", fresh);
    } else if (decoded.exp) {
      const secondsLeft = decoded.exp - Math.floor(Date.now() / 1000);
      if (secondsLeft > 0 && secondsLeft < 12 * 3600) {
        res.set("X-Admin-Token", signAdmin({ uid: user.id }));
      }
    }

    req.admin = user;
    next();
  } catch (err) {
    next(err);
  }
};

module.exports.clientIp = clientIp;
