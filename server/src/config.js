const path = require("path");

// Корень репозитория: uploads/ и собранный web/dist лежат относительно него.
const REPO_ROOT = path.resolve(__dirname, "../..");

module.exports = {
  UPLOADS_ROOT: process.env.UPLOADS_DIR || path.join(REPO_ROOT, "uploads"),
  WEB_DIST: path.join(REPO_ROOT, "web", "dist")
};
