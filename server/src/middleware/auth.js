const db = require("../db");
const jwtUtil = require("../utils/jwt");

// Проверяет JWT, кладёт актуального пользователя в req.user
module.exports = async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "no_token" });

    let payload;
    try {
      payload = jwtUtil.verify(token);
    } catch {
      return res.status(401).json({ error: "invalid_token" });
    }

    const { rows } = await db.query("SELECT * FROM users WHERE id = $1", [payload.uid]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "user_not_found" });
    if (user.is_blocked) return res.status(403).json({ error: "blocked" });

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
