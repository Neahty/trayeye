// npm run seed - пересоздать демо-данные и вывести ссылки входа.
require("../env");
const db = require(".");
const { seed } = require("./seed");
const { today } = require("../utils/dates");

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_FORCE !== "1") {
    throw new Error("seed стирает все данные; в production запускай с SEED_FORCE=1");
  }
  await db.migrate();
  const started = Date.now();
  const result = await db.withTx((client) => seed(client, { today: today() }));
  console.log(`[seed] готово за ${Math.round((Date.now() - started) / 1000)} с, дни ${result.days.from}..${result.days.to}, прогноз на ${result.days.next}`);
  console.log(`\nКомбинат: ${result.links.kombinat}`);
  for (const d of result.links.directors) console.log(`${d.school} (${d.director}): ${d.url}`);
}

main()
  .catch((err) => {
    console.error("[seed]", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.pool.end());
