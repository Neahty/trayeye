// Выдать ссылку входа из консоли.
//   npm run link -- kombinat <kombinat_id>
//   npm run link -- director <director_id>
require("../env");
const db = require(".");
const { createLink } = require("../services/links");

async function main() {
  const [role, rawId] = process.argv.slice(2);
  const id = Number(rawId);
  if (!["kombinat", "director"].includes(role) || !Number.isInteger(id) || id <= 0) {
    console.error("Использование: npm run link -- kombinat|director <id>");
    process.exitCode = 1;
    return;
  }
  let kombinatId = id;
  let directorId = null;
  if (role === "director") {
    const { rows } = await db.query(
      "SELECT d.id, s.kombinat_id FROM directors d JOIN schools s ON s.id = d.school_id WHERE d.id = $1",
      [id]
    );
    if (!rows[0]) throw new Error(`директор ${id} не найден`);
    kombinatId = rows[0].kombinat_id;
    directorId = rows[0].id;
  } else {
    const { rows } = await db.query("SELECT id FROM kombinats WHERE id = $1", [id]);
    if (!rows[0]) throw new Error(`комбинат ${id} не найден`);
  }
  const link = await createLink(db, { role, kombinatId, directorId });
  console.log(link.url);
}

main()
  .catch((err) => {
    console.error("[link]", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
