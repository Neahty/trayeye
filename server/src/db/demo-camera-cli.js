// Ответы ИИ для демо «экран камеры» (страница /camera): один раз отправляет в ИИ кадры
// подносов с остатками из web/public/demo/camera.json и дописывает ответы в тот же файл.
// Запускать там, где есть ключи ИИ (РФ-сервер), после camera/tools/make_web_demo.py:
//   npm run demo-camera -- /path/to/web/public/demo
require("../env");
const fs = require("fs");
const path = require("path");
const vision = require("../services/vision");
const { DISHES } = require("./demoData");

// Блюда, которые кладёт на подносы camera/tools/make_demo_video.py.
const VIDEO_DISHES = ["borscht", "shchi", "pea-soup", "chicken-noodle-soup", "plov", "buckwheat", "pasta", "rice",
  "mashed-potatoes", "cutlets", "meatballs", "fish-cutlets", "kompot", "kissel", "tea"];
const BATCH = 6;

async function main() {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, "../../../web/public/demo"));
  const file = path.join(dir, "camera.json");
  const demo = JSON.parse(fs.readFileSync(file, "utf8"));
  const menu = VIDEO_DISHES.map((slug, i) => ({ dish_id: i + 1, name: DISHES.find((d) => d.slug === slug).name }));
  const names = new Map(menu.map((m) => [m.dish_id, m.name]));

  const pending = demo.events.filter((e) => !e.empty);
  for (let k = 0; k < pending.length; k += BATCH) {
    const chunk = pending.slice(k, k + BATCH);
    const images = chunk.map((e) => ({ buffer: fs.readFileSync(path.join(dir, e.crop)), mime: "image/jpeg" }));
    const { results, model } = await vision.analyzeTrays({ images, menu });
    chunk.forEach((e, j) => {
      // На кадре один поднос: берём первый, где модель нашла блюда из меню.
      const items = (results[j] || []).find((t) => t.length) || [];
      e.ai = { model, items: items.map((it) => ({ name: names.get(it.dish_id), leftover_pct: it.leftover_pct })) };
    });
    console.log(`Подносов ${k + chunk.length}/${pending.length}: ${model}`);
  }
  fs.writeFileSync(file, JSON.stringify(demo));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
