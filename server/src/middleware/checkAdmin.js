module.exports = function checkAdmin(req, res, next) {
  if (!req.user || !req.user.is_admin) {
    return res.status(403).json({ error: "admin_only" });
  }
  next();
};
