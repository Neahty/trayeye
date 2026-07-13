const { signAdmin } = require("./jwt");

const ADMIN_SESSION_COOKIE = "admin_session";
const ADMIN_SESSION_SECONDS = Number(process.env.ADMIN_SESSION_SECONDS || 24 * 3600);

function cookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: process.env.ADMIN_COOKIE_SAMESITE || "lax",
    path: "/api/admin",
    maxAge: ADMIN_SESSION_SECONDS * 1000
  };
}

function setAdminSession(res, payload) {
  const token = signAdmin(payload, `${ADMIN_SESSION_SECONDS}s`);
  res.cookie(ADMIN_SESSION_COOKIE, token, cookieOptions());
  return token;
}

function clearAdminSession(res) {
  res.clearCookie(ADMIN_SESSION_COOKIE, {
    ...cookieOptions(),
    maxAge: undefined
  });
}

function shouldRefreshAdminSession(decoded) {
  if (!decoded?.exp) return false;
  const secondsLeft = decoded.exp - Math.floor(Date.now() / 1000);
  return secondsLeft > 0 && secondsLeft < ADMIN_SESSION_SECONDS / 2;
}

module.exports = {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_SECONDS,
  setAdminSession,
  clearAdminSession,
  shouldRefreshAdminSession
};
