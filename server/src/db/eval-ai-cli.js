// Проверка ИИ на подносах с известными ответами (их готовит camera/tools/eval_belt.py).
//   npm run eval-ai -- <папка ai-set> [--model gemini-3.5-flash-lite] [--batch 8] [--prompt v2|v1]
// Пишет answers-<model>-<prompt>.json рядом с кадрами и печатает метрики:
// узнавание блюд, средняя ошибка остатка в процентных пунктах, как часто ответ «50».
require("../env");
const fs = require("fs");
const path = require("path");
const vision = require("../services/vision");
const { DISHES } = require("./demoData");

// Блюда, которые кладёт на подносы camera/tools/make_demo_video.py.
const VIDEO_DISHES = ["borscht", "shchi", "pea-soup", "chicken-noodle-soup", "plov", "buckwheat", "pasta", "rice",
  "mashed-potatoes", "cutlets", "meatballs", "fish-cutlets", "kompot", "kissel", "tea"];
const DRINKS = new Set(["kompot", "kissel", "tea"]);

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

async function main() {
  const dir = path.resolve(process.argv[2]);
  const model = arg("model", "gemini-3.5-flash-lite");
  const batch = Number(arg("batch", 8));
  const promptName = arg("prompt", "v2");
  const truth = JSON.parse(fs.readFileSync(path.join(dir, "truth.json"), "utf8"));
  const menu = VIDEO_DISHES.map((slug, i) => ({ dish_id: i + 1, name: DISHES.find((d) => d.slug === slug).name }));
  const slugById = new Map(VIDEO_DISHES.map((slug, i) => [i + 1, slug]));

  // Как в школе: ИИ получает меню своего обеда (поле menu у подноса, его пишет генератор ленты),
  // пачка - подносы одного обеда. Без поля menu - все блюда ленты.
  const groups = new Map();
  for (const t of truth) {
    const key = (t.menu || VIDEO_DISHES).join(",");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  const answered = new Map();
  const started = Date.now();
  let done = 0;
  for (const [key, trays] of groups) {
    const dayMenu = menu.filter((m) => key.split(",").includes(slugById.get(m.dish_id)));
    for (let k = 0; k < trays.length; k += batch) {
      const chunk = trays.slice(k, k + batch);
      const images = chunk.map((t) => ({ buffer: fs.readFileSync(path.join(dir, t.file)), mime: "image/jpeg" }));
      const { results } = await vision.analyzeTrays({ images, menu: dayMenu, models: [model], prompt: promptName });
      chunk.forEach((t, j) => {
        const items = (results[j] || []).find((tr) => tr.length) || [];
        answered.set(t.tray, { tray: t.tray, items: items.map((it) => ({ dish: slugById.get(it.dish_id), leftover_pct: it.leftover_pct })) });
      });
      done += chunk.length;
      process.stdout.write(`.${done}`);
    }
  }
  console.log();
  const answers = truth.map((t) => answered.get(t.tray));

  // Метрики: по каждому блюду на подносе - узнано ли и насколько ошиблись в остатке.
  let hit = 0;
  let total = 0;
  let predicted = 0;
  const errFood = [];
  const errDrink = [];
  let fifty = 0;
  let fiftyTruth = 0;
  truth.forEach((t, i) => {
    const pred = new Map(answers[i].items.map((it) => [it.dish, it.leftover_pct]));
    predicted += pred.size;
    for (const it of t.items) {
      total += 1;
      const got = pred.get(it.dish);
      if (got !== undefined) hit += 1;
      // Блюдо не названо: в базу ничего не запишется - считаем это ответом «0».
      const err = Math.abs((got ?? 0) - it.leftover_pct);
      (DRINKS.has(it.dish) ? errDrink : errFood).push(err);
      if (it.leftover_pct === 50) fiftyTruth += 1;
    }
    for (const v of pred.values()) if (v === 50) fifty += 1;
  });
  const report = {
    model,
    prompt: promptName,
    trays: truth.length,
    dish_recall: +(hit / total).toFixed(3),
    dish_precision: +(hit / Math.max(1, predicted)).toFixed(3),
    wrong_dishes: predicted - hit,
    mae_food_pp: +mean(errFood).toFixed(1),
    mae_drink_pp: +mean(errDrink).toFixed(1),
    within_20pp_food: +(errFood.filter((e) => e <= 20).length / errFood.length).toFixed(3),
    answers_50: `${fifty}/${predicted}`,
    truth_50: `${fiftyTruth}/${total}`,
    seconds: Math.round((Date.now() - started) / 1000)
  };
  fs.writeFileSync(path.join(dir, `answers-${model}-${promptName}.json`), JSON.stringify({ report, answers }, null, 1));
  console.log(JSON.stringify(report));
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
