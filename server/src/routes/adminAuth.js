const express = require("express");
const bcrypt = require("bcryptjs");
const { authenticator } = require("otplib");
const qrcode = require("qrcode");
const rateLimit = require("express-rate-limit");
const db = require("../db");
const adminAuth = require("../middleware/adminAuth");
const { clientIp } = require("../middleware/adminAuth");
const { setAdminSession, clearAdminSession } = require("../utils/adminSession");

const router = express.Router();

const MAX_ATTEMPTS = Number(process.env.ADMIN_MAX_ATTEMPTS || 5);
const LOCK_MINUTES = Number(process.env.ADMIN_LOCK_MINUTES || 15);

// Жёсткий rate-limit на попытки логина
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests" }
});

async function findAdmin(identifier) {
  const isNumeric = /^\d+$/.test(String(identifier).trim());
  const { rows } = await db.query(
    `SELECT u.*, ac.password_hash, ac.totp_secret, ac.totp_enabled
     FROM users u LEFT JOIN admin_credentials ac ON ac.user_id = u.id
     WHERE u.is_admin = TRUE AND (u.email = $1 OR ($2::bool AND u.telegram_id = $3::bigint))
     LIMIT 1`,
    [String(identifier).trim(), isNumeric, isNumeric ? identifier : 0]
  );
  return rows[0] || null;
}

async function recentFailures(identifier, ip) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS c FROM admin_login_attempts
     WHERE success = FALSE AND (identifier = $1 OR ip = $2)
       AND created_at >= NOW() - ($3 || ' minutes')::interval`,
    [String(identifier), ip, LOCK_MINUTES]
  );
  return rows[0]?.c || 0;
}

async function logAttempt(identifier, ip, success) {
  await db.query(
    "INSERT INTO admin_login_attempts (identifier, ip, success) VALUES ($1,$2,$3)",
    [String(identifier || ""), ip, success]
  );
}

// POST /api/admin/auth/login  { identifier, password, totp }
router.post("/login", loginLimiter, async (req, res, next) => {
  const ip = clientIp(req);
  const { identifier, password, totp } = req.body || {};
  try {
    if (!identifier || !password) return res.status(400).json({ error: "missing_credentials" });

    const failures = await recentFailures(identifier, ip);
    if (failures >= MAX_ATTEMPTS) {
      return res.status(429).json({ error: "locked", retry_after_minutes: LOCK_MINUTES });
    }

    const admin = await findAdmin(identifier);
    if (!admin || !admin.password_hash) {
      await logAttempt(identifier, ip, false);
      return res.status(401).json({ error: "invalid_credentials" });
    }
    if (admin.is_blocked) {
      await logAttempt(identifier, ip, false);
      return res.status(403).json({ error: "blocked" });
    }

    const passOk = await bcrypt.compare(String(password), admin.password_hash);
    if (!passOk) {
      await logAttempt(identifier, ip, false);
      return res.status(401).json({ error: "invalid_credentials" });
    }

    if (admin.totp_enabled) {
      if (!totp) {
        return res.status(401).json({ error: "totp_required", totp_required: true });
      }
      const valid = authenticator.verify({ token: String(totp), secret: admin.totp_secret });
      if (!valid) {
        await logAttempt(identifier, ip, false);
        return res.status(401).json({ error: "invalid_totp" });
      }
    }

    await logAttempt(identifier, ip, true);
    await db.logAction(admin.id, "admin_action", { action: "admin_login", ip });

    const token = setAdminSession(res, { uid: admin.id });
    res.json({
      token,
      admin: { id: admin.id, name: admin.name, username: admin.username, telegram_id: admin.telegram_id },
      totp_enabled: !!admin.totp_enabled
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/auth/me
router.get("/me", adminAuth, async (req, res) => {
  const { rows } = await db.query(
    "SELECT totp_enabled FROM admin_credentials WHERE user_id = $1",
    [req.admin.id]
  );
  res.json({
    admin: { id: req.admin.id, name: req.admin.name, username: req.admin.username, telegram_id: req.admin.telegram_id },
    totp_enabled: !!rows[0]?.totp_enabled
  });
});

// POST /api/admin/auth/logout (клиент просто удаляет токен; пишем в лог)
router.post("/logout", adminAuth, async (req, res) => {
  await db.logAction(req.admin.id, "admin_action", { action: "admin_logout" });
  clearAdminSession(res);
  res.json({ ok: true });
});

// POST /api/admin/auth/setup-2fa - генерирует секрет + QR
router.post("/setup-2fa", adminAuth, async (req, res, next) => {
  try {
    const secret = authenticator.generateSecret();
    const label = `Bytwise Admin (${req.admin.username || req.admin.telegram_id})`;
    const otpauth = authenticator.keyuri(String(req.admin.telegram_id), "Bytwise", secret);
    await db.query(
      `INSERT INTO admin_credentials (user_id, totp_secret, totp_enabled)
       VALUES ($1,$2,FALSE)
       ON CONFLICT (user_id) DO UPDATE SET totp_secret = EXCLUDED.totp_secret, totp_enabled = FALSE`,
      [req.admin.id, secret]
    );
    const qr = await qrcode.toDataURL(otpauth);
    res.json({ secret, otpauth, qr });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/auth/verify-2fa  { totp } - включает 2FA
router.post("/verify-2fa", adminAuth, async (req, res, next) => {
  try {
    const { totp } = req.body || {};
    const { rows } = await db.query("SELECT totp_secret FROM admin_credentials WHERE user_id = $1", [req.admin.id]);
    const secret = rows[0]?.totp_secret;
    if (!secret) return res.status(400).json({ error: "no_secret" });
    if (!authenticator.verify({ token: String(totp), secret })) {
      return res.status(401).json({ error: "invalid_totp" });
    }
    await db.query("UPDATE admin_credentials SET totp_enabled = TRUE WHERE user_id = $1", [req.admin.id]);
    await db.logAction(req.admin.id, "admin_action", { action: "enable_2fa" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/auth/change-password { current_password, new_password }
router.post("/change-password", adminAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    if (!new_password || String(new_password).length < 8) {
      return res.status(400).json({ error: "weak_password" });
    }
    const { rows } = await db.query("SELECT password_hash FROM admin_credentials WHERE user_id = $1", [req.admin.id]);
    const hash = rows[0]?.password_hash;
    if (hash) {
      const ok = await bcrypt.compare(String(current_password || ""), hash);
      if (!ok) return res.status(401).json({ error: "invalid_current_password" });
    }
    const newHash = await bcrypt.hash(String(new_password), 12);
    await db.query(
      `INSERT INTO admin_credentials (user_id, password_hash, password_changed_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (user_id) DO UPDATE SET password_hash = EXCLUDED.password_hash, password_changed_at = NOW()`,
      [req.admin.id, newHash]
    );
    await db.logAction(req.admin.id, "admin_action", { action: "change_password" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
