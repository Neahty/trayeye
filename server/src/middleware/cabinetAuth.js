const db = require("../db");
const jwtUtil = require("../utils/jwt");

// Кто вошёл: роль и то, к чему у него доступ. Ссылку проверяем на каждом запросе,
// поэтому отзыв ссылки комбинатом сразу закрывает уже выданные сессии.
async function loadCabinet(linkId) {
  const { rows } = await db.query(
    `SELECT l.id AS link_id, l.role, l.kombinat_id, k.name AS kombinat_name,
            d.id AS director_id, d.full_name, d.avatar_url,
            s.id AS school_id, s.number AS school_number, s.name AS school_name
       FROM access_links l
       JOIN kombinats k ON k.id = l.kombinat_id
       LEFT JOIN directors d ON d.id = l.director_id
       LEFT JOIN schools s ON s.id = d.school_id
      WHERE l.id = $1 AND l.revoked_at IS NULL`,
    [linkId]
  );
  const r = rows[0];
  if (!r) return null;
  return {
    linkId: r.link_id,
    role: r.role,
    kombinatId: r.kombinat_id,
    kombinatName: r.kombinat_name,
    directorId: r.director_id,
    fullName: r.full_name,
    avatarUrl: r.avatar_url,
    schoolId: r.school_id,
    schoolNumber: r.school_number,
    schoolName: r.school_name
  };
}

// cabinetAuth() - любая роль; cabinetAuth("director") - только директор.
function cabinetAuth(requiredRole = null) {
  return async function (req, res, next) {
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

      const cabinet = await loadCabinet(payload.lid);
      if (!cabinet) return res.status(401).json({ error: "link_revoked" });
      if (requiredRole && cabinet.role !== requiredRole) {
        return res.status(403).json({ error: "forbidden" });
      }

      req.cabinet = cabinet;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { cabinetAuth, loadCabinet };
