const axios = require("axios");

const API_KEY = process.env.OPENAI_API_KEY || "";
// Модель зрения сильнее оценивает порции — отдельная от текстовой.
// Намеренно НЕ наследуем от OPENAI_MODEL (там старая слабая gpt-4o-mini): для точности
// порций по умолчанию берём gpt-4.1 для фото. Переопределяется отдельными env при желании.
const VISION_MODEL = process.env.OPENAI_VISION_MODEL || "gpt-4.1";
const TEXT_MODEL = process.env.OPENAI_TEXT_MODEL || "gpt-4.1-mini";
// Для обратной совместимости (старый экспорт/фолбэк в учёте расходов)
const MODEL = VISION_MODEL;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
// Gemini отвечает в OpenAI-совместимом формате — тело запроса и разбор ответа общие.
const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";
// Фото анализирует бесплатный Gemini, OpenAI остаётся страховкой.
// Модели перечислены по порядку: суточная квота (500 запросов) считается ОТДЕЛЬНО на каждую,
// поэтому вторая модель не дублирует первую, а удваивает бесплатный запас.
// Замеры на боевых фото: 3.1-flash-lite точнее 3.5-flash-lite (медиана расхождения 13% против 16%).
// «Размышления» (reasoning_effort) намеренно не включаем — на lite-моделях они не улучшают
// оценку, только удваивают время ответа. Полноразмерные Flash не годятся: у них лимит 20 фото в сутки.
const GEMINI_VISION_MODELS = (process.env.GEMINI_VISION_MODELS || "gemini-3.1-flash-lite,gemini-3.5-flash-lite")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Цепочка провайдеров для фото: бесплатные Gemini → платный OpenAI.
// Переключение молчаливое: пользователь не замечает, кто именно посчитал его тарелку.
function visionChain() {
  const chain = GEMINI_API_KEY
    ? GEMINI_VISION_MODELS.map((model) => ({ name: "gemini", url: GEMINI_URL, apiKey: GEMINI_API_KEY, model }))
    : [];
  chain.push({ name: "openai", url: OPENAI_URL, apiKey: API_KEY, model: VISION_MODEL });
  return chain;
}

// Текст пока только на OpenAI: качество Gemini на текстовых описаниях не проверялось,
// а стоит этот путь копейки (~5% расходов). Перевести можно тем же способом, что и фото.
function textChain() {
  return [{ name: "openai", url: OPENAI_URL, apiKey: API_KEY, model: TEXT_MODEL }];
}

const IMAGE_PROMPT = `Ты — эксперт-нутрициолог и шеф-повар. Твои задачи: (1) ТОЧНО определить, ЧТО за блюдо,
(2) ЧЕСТНО оценить МАССУ порции, (3) посчитать КБЖУ ИМЕННО для этой массы.

ПОРЯДОК ДЕЙСТВИЙ (обязателен). Сначала заполни поле "analysis": СНАЧАЛА ПРОВЕРЬ, нет ли на фото
упаковки/этикетки с пищевой ценностью (см. блок «УПАКОВКА» ниже) — если есть, это ГЛАВНЫЙ источник чисел.
Иначе ОПОЗНАЙ блюдо по РЕАЛЬНО видимым признакам (цвет, форма, текстура, ключевые ингредиенты, посуда),
а не по тому, что «обычно» бывает; что именно видно и ключевые ингредиенты; к какой кухне относится;
КАК ты оцениваешь массу (на какие референсы опираешься) и итоговый вес в граммах; какую плотность
калорий (ккал/г) берёшь для этого блюда; и как из массы и плотности получается итог
(калории ≈ вес_г × плотность). Укажи в analysis, ОТКУДА числа: «с этикетки» или «визуальная оценка».
ТОЛЬКО ПОСЛЕ этого заполни dishes числами для всей порции.
Верни ТОЛЬКО JSON без пояснений в формате:
{"analysis":"...","dishes":[{"dish_name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"weight_grams":0,"confidence":"high|medium|low"}]}

УПАКОВКА / ЭТИКЕТКА (приоритет над визуальной оценкой — если видно, читай ПОЛНОСТЬЮ):
- Если на фото видна упаковка с таблицей «Пищевая ценность» (КБЖУ) — это ТОЧНЕЕ, чем оценка на глаз. Используй её.
- Считай ВСЮ таблицу: ккал, белки, жиры, углеводы на 100 г (или на порцию — что указано). Прочти и название продукта/бренд, и «масса нетто», и число порций в упаковке.
- Пересчёт на съеденное: итог = (значения на 100 г) × (съеденная масса в граммах ÷ 100). Если съедена ВСЯ упаковка — бери массу нетто; если часть — оцени эту часть по виду.
- Если значения на этикетке даны «на порцию» — бери их и умножь на количество съеденных порций.
- Название бери с упаковки (бренд + продукт). confidence "high", если таблица читается чётко и масса понятна.
- Если на этикетке часть цифр не видна/размыта — оцени недостающее разумно и поставь confidence "medium".

КАК ОЦЕНИВАТЬ МАССУ (важнее всего — здесь чаще всего ошибаются):
- Опирайся на референсы масштаба: диаметр обычной тарелки ~26 см, столовая ложка ~15 мл, вилка ~19 см,
  ладонь ~18 см, стакан ~250 мл, банка/упаковка с этикеткой. Найди такой ориентир на фото и оцени размер еды относительно него.
- Учитывай ОБЪЁМ И ВЫСОТУ горки еды, а не только площадь на фото. Высокая горка/полная миска/несколько порционных
  кусков весят в РАЗЫ больше, чем тонкий слой той же площади. Большая ёмкость с едой может весить килограммы — не занижай.
- Прикинь массу через объём и плотность (≈1 г/мл для большинства готовой еды, мясо/сыр плотнее, салат/попкорн легче).
- НЕ занижай и НЕ ставь по умолчанию 100 г — оцени честно (может быть 30, 180, 350, 1200, 5000 и т.д.).
  Вес — реалистичное число, а НЕ «ровные» 100/200/300 без причины.
- Если порций/кусков несколько — умножай массу одной на количество.

КБЖУ — ДЛЯ ВСЕЙ ОЦЕНЁННОЙ МАССЫ ПОРЦИИ (weight_grams), а НЕ на 100 г:
- Считай калории как вес × реалистичная плотность для этого блюда (типичная готовая еда ~1–2.5 ккал/г;
  супы/салаты меньше, жирное/выпечка/орехи больше). Сопоставь итог с массой: 10 кг еды не могут быть 250 ккал.
- НЕ ОКРУГЛЯЙ итог до сотен/полусотен. Дай точное число (например 437, а не 450; 1180, а не 1200).
- ПРОВЕРЬ согласованность: калории ≈ protein*4 + carbs*4 + fat*9 (допуск ±15%). Если не сходится — пересчитай
  макросы и/или калории так, чтобы и масса, и энергия были логичны, ПРЕЖДЕ чем вернуть ответ.

НАЗВАНИЕ И СОСТАВ (точность важнее красивого названия):
- Название должно соответствовать тому, что РЕАЛЬНО на фото. НЕ подгоняй под знакомое/типичное блюдо,
  если цвет, форма, текстура или ингредиенты не совпадают — это частая ошибка (назвать не ту еду).
- Если конкретное блюдо опознать уверенно НЕЛЬЗЯ — дай ВЕРНОЕ обобщённое название по видимым компонентам
  («Мясо с овощами», «Каша с фруктами», «Запеканка», «Суп с овощами»), а НЕ выдумывай конкретное; ставь confidence "medium"/"low".
- Когда блюдо опознаётся уверенно — назови его максимально конкретно и узнаваемо: «Салат Цезарь с курицей», «Борщ», «Плов»,
  «Паста карбонара», «Сырники со сметаной» — а НЕ обобщённо («салат», «суп», «еда», «Блюдо»).
- Составное/именованное блюдо — это ОДНА запись, НЕ разбивай его на ингредиенты
  (кукуруза + сыр + листья + курица = «Салат Цезарь», а не четыре записи).
- Несколько объектов dishes — ТОЛЬКО если на тарелке несколько РАЗНЫХ самостоятельных
  блюд/продуктов (например плов, банан и морковь — это ТРИ записи).
- Если на фото упаковка с этикеткой — действуй по блоку «УПАКОВКА» выше (читай таблицу КБЖУ и состав полностью).
- Числа (масса/КБЖУ) заполняй ВСЕГДА и давай одну лучшую оценку — но в НАЗВАНИИ не выдумывай конкретное
  блюдо ради уверенности: лучше верное обобщённое название, чем уверенно неправильное.
  confidence: "high" только если уверен И в названии, И в массе; "medium"/"low" если сомневаешься в любом из них.
- Если на фото нет еды — верни {"analysis":"...","dishes":[]}.

ПРИМЕРЫ (показывают ход рассуждения внутри analysis; числа не копируй):
- Тарелка: {"analysis":"Паста карбонара на тарелке ~26 см, заполнена на 2/3, горка средней высоты → ~320 г. Карбонара жирная, плотность ~2.02 ккал/г → 320×2.02≈646 ккал. Белок ~24 г, жир ~34 г, углеводы ~63 г (проверка 24×4+63×4+34×9=654≈646). Источник: визуальная оценка.","dishes":[{"dish_name":"Паста карбонара","calories":646,"protein":24,"fat":34,"carbs":63,"weight_grams":320,"confidence":"medium"}]}
- Упаковка: {"analysis":"Этикетка йогурта: на 100 г — 99 ккал, белки 3.2, жиры 3.4, углеводы 13.5. Масса нетто 290 г, съедена вся → ×2.9. Источник: с этикетки. 99×2.9≈287 ккал, белок 9.3, жир 9.9, углеводы 39.2.","dishes":[{"dish_name":"Йогурт питьевой","calories":287,"protein":9.3,"fat":9.9,"carbs":39.2,"weight_grams":290,"confidence":"high"}]}`;

const TEXT_PROMPT = `Ты диетолог. Пользователь текстом описывает, что он съел. Оцени массу порции и КБЖУ ИМЕННО для этой массы.
ПОРЯДОК: сначала заполни поле "analysis" — какое это блюдо, какую массу порции берёшь (в граммах) и почему,
какую плотность калорий (ккал/г) и как из массы и плотности получается итог (калории ≈ вес_г × плотность).
ТОЛЬКО ПОСЛЕ этого заполни dishes. Верни ТОЛЬКО JSON без пояснений в формате:
{"analysis":"...","dishes":[{"dish_name":"...","calories":0,"protein":0,"fat":0,"carbs":0,"weight_grams":0,"confidence":"high|medium|low"}]}
- Составное/именованное блюдо считай ОДНИМ блюдом и НЕ разбивай на ингредиенты
  («салат Цезарь», «борщ», «плов», «бургер» — одна запись, а не кукуруза/сыр/салат отдельно).
- Несколько объектов dishes — только если пользователь перечислил несколько разных блюд.
- Учитывай указанные порции/количество (шт, г, мл). Если порция не указана — оцени реальную массу
  стандартной порции в граммах (weight_grams), НЕ ставь по умолчанию 100 и не бери «ровные» числа без причины.
- Если пользователь привёл данные с упаковки (КБЖУ на 100 г) и массу — пересчитай на эту массу
  (итог = значения_на_100г × масса_г ÷ 100), а НЕ возвращай значения на 100 г.
- calories/protein/fat/carbs — для всей массы порции, а НЕ на 100 г.
- НЕ ОКРУГЛЯЙ итог до сотен/полусотен — дай точное число (например 437, а не 450).
- ПРОВЕРЬ: калории ≈ protein*4 + carbs*4 + fat*9 (±15%). Если не сходится — пересчитай перед ответом.
- dish_name — короткое узнаваемое название блюда на русском.
- Всегда давай одну лучшую оценку, НЕ отказывайся из-за неуверенности; числа заполняй всегда.
- Если описание непонятное или это не еда — верни {"analysis":"...","dishes":[]}.

ПРИМЕР (показывает ход рассуждения внутри analysis; числа не копируй):
{"analysis":"\\"200 г куриной грудки\\" — масса задана, 200 г. Отварная грудка ~1.61 ккал/г → 200×1.61≈322 ккал. Белок ~62 г, жир ~7 г, углеводы 0 (проверка 62×4+7×9=311≈322).","dishes":[{"dish_name":"Куриная грудка","calories":322,"protein":62,"fat":7,"carbs":0,"weight_grams":200,"confidence":"high"}]}`;

// Кто именно посчитал тарелку — для лога в канал. Важно видеть глазами: Gemini работает
// на бесплатном тире, а уход на OpenAI (резерв) стоит денег. Определяем по префиксу имени
// модели — тем же способом, что и тариф в services/cost.js.
function modelLabel(model) {
  const m = String(model || "").trim();
  if (!m) return "неизвестно";
  if (m.startsWith("gemini")) return `Gemini — бесплатно (${m})`;
  return `ChatGPT — платно (${m})`;
}

function extractJson(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

// Согласование КБЖУ по правилу Атуотера: 1 г белка/углеводов = 4 ккал, 1 г жира = 9 ккал.
// Страхует от случаев, когда модель вернула калории, не бьющиеся с макросами.
function reconcileMacros(dish) {
  const implied = dish.protein * 4 + dish.carbs * 4 + dish.fat * 9;
  if (implied <= 0) return dish; // нет макросов — доверяем калориям как есть
  if (dish.calories <= 0) {
    dish.calories = Math.round(implied);
    return dish;
  }
  const diff = Math.abs(dish.calories - implied) / implied;
  if (diff > 0.2) {
    // Калории сильно расходятся с макросами — доверяем макросам и снижаем уверенность.
    dish.calories = Math.round(implied);
    if (dish.confidence === "high") dish.confidence = "medium";
  }
  return dish;
}

function normalizeDish(d) {
  const dish = {
    dish_name: d.dish_name || d.name || "Блюдо",
    calories: Math.round(Number(d.calories) || 0),
    protein: Math.round((Number(d.protein) || 0) * 10) / 10,
    fat: Math.round((Number(d.fat) || 0) * 10) / 10,
    carbs: Math.round((Number(d.carbs) || 0) * 10) / 10,
    weight_grams: Math.round(Number(d.weight_grams) || 0),
    confidence: ["high", "medium", "low"].includes(d.confidence) ? d.confidence : "medium"
  };
  const reconciled = reconcileMacros(dish);
  // Проверка вменяемости: больше 9 ккал/г физически невозможно (чистый жир = 9 ккал/г).
  // Числа не трогаем (их правит только Атуотер выше), но помечаем оценку как ненадёжную.
  if (reconciled.weight_grams > 0 && reconciled.calories / reconciled.weight_grams > 9) {
    reconciled.confidence = "low";
  }
  return reconciled;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// hasNext — есть ли в цепочке следующий провайдер. Если есть, на 429 (кончилась квота)
// не ретраим: Gemini просит ждать до минуты, а держать пользователя столько нельзя —
// быстрее молча уйти к следующему провайдеру.
async function callProvider(provider, messages, maxTokens, hasNext = false) {
  if (!provider.apiKey) {
    const err = new Error(`${provider.name}_not_configured`);
    err.status = 503;
    err.model = provider.model;
    throw err;
  }
  // Ретраи разовых сбоев: сеть / 5xx / 429 (rate limit) — до 3 попыток с нарастающей паузой.
  // Из-за них раньше в логах появлялись «Request failed with status code 500».
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data } = await axios.post(
        provider.url,
        { model: provider.model, messages, max_tokens: maxTokens, temperature: 0.2, response_format: { type: "json_object" } },
        {
          headers: { Authorization: `Bearer ${provider.apiKey}`, "Content-Type": "application/json" },
          timeout: 60000
        }
      );
      return data;
    } catch (err) {
      err.model = provider.model;
      err.provider = provider.name;
      lastErr = err;
      const status = err.response?.status;
      if (status === 429 && hasNext) break;
      const retryable = !err.response || status >= 500 || status === 429;
      if (!retryable || attempt === 2) break;
      await sleep(400 * (attempt + 1));
    }
  }
  throw lastErr;
}

// Достаёт блюда из ответа модели, ВКЛЮЧАЯ обрезанный/битый JSON.
// 1) пробуем разобрать весь ответ; 2) если не вышло — вытаскиваем отдельные завершённые
// объекты блюд {...} (плоские, без вложенных скобок) — так уцелевшие блюда не теряются,
// даже если массив оборвался на середине из-за лимита токенов. Возвращает массив (возможно пустой).
function parseDishes(content) {
  if (!content) return [];
  const full = extractJson(content);
  if (full && Array.isArray(full.dishes) && full.dishes.length) {
    return full.dishes.map(normalizeDish);
  }
  const objs = content.match(/\{[^{}]*\}/g) || [];
  const dishes = [];
  for (const o of objs) {
    try {
      const d = JSON.parse(o);
      if (d && (d.dish_name || d.name) && (d.calories != null || d.protein != null)) {
        dishes.push(normalizeDish(d));
      }
    } catch { /* не блюдо — пропускаем */ }
  }
  return dishes;
}

// Запасное блюдо: создаётся, когда модель так и не вернула результат — чтобы еда добавлялась ВСЕГДА.
// Низкая уверенность подсветит в клиенте «проверьте запись», пользователь поправит числа.
function fallbackDish(name) {
  return normalizeDish({
    dish_name: (name && String(name).trim().slice(0, 80)) || "Блюдо",
    calories: 0, protein: 0, fat: 0, carbs: 0, weight_grams: 0, confidence: "low"
  });
}

// Один провайдер: вызов → разбор → повтор (обрезка/пусто).
// dishes пустой, если модель так и не вернула ни одного блюда.
async function analyzeWith(provider, messages, maxTokens, hasNext) {
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let finishReason = null;
  let tokens = maxTokens;
  let msgs = messages;

  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await callProvider(provider, msgs, tokens, hasNext);
    const choice = data.choices?.[0] || {};
    const content = choice.message?.content || "";
    finishReason = choice.finish_reason || null;
    usage = data.usage || usage;

    const dishes = parseDishes(content);
    if (dishes.length) {
      const low_confidence = dishes.some((d) => d.confidence === "low");
      return { dishes, low_confidence, usage, model: provider.model, finish_reason: finishReason, fallback: false };
    }

    // Блюд нет — готовим повтор: при обрезке даём больше места, иначе жмём вернуть хотя бы одно блюдо.
    if (finishReason === "length") {
      tokens = Math.min(tokens * 2, 4000);
    } else {
      msgs = msgs.concat([{
        role: "user",
        content: 'Верни СТРОГО JSON {"dishes":[...]} минимум с ОДНИМ блюдом и лучшей оценкой КБЖУ. Пустой массив не возвращай.'
      }]);
    }
  }

  return { dishes: [], usage, model: provider.model, finish_reason: finishReason };
}

// Идём по цепочке: побеждает первый провайдер, вернувший блюда.
// Упал или отдал пустоту — молча берём следующего. Всегда возвращает непустой
// { dishes, low_confidence, usage, model, finish_reason, fallback } либо кидает ошибку,
// если не ответил ВООБЩЕ никто (тогда роут отдаст ai_failed, как и раньше).
async function analyze({ providers, messages, maxTokens, fallbackName }) {
  let lastErr = null;
  let lastEmpty = null;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const hasNext = i < providers.length - 1;
    try {
      const result = await analyzeWith(provider, messages, maxTokens, hasNext);
      if (result.dishes.length) return result;
      lastEmpty = result;
    } catch (err) {
      lastErr = err;
      console.error(`[ai] ${provider.name}/${provider.model} не справился: ${err.message} — пробую следующего`);
    }
  }

  // Все провайдеры упали с ошибкой и никто даже не ответил — это ошибка, а не «не распознал».
  if (!lastEmpty && lastErr) throw lastErr;

  // Кто-то ответил, но блюд не нашёл. Запас: еда добавляется всегда (с пометкой низкой уверенности).
  return {
    dishes: [fallbackDish(fallbackName)],
    low_confidence: true,
    usage: lastEmpty.usage,
    model: lastEmpty.model,
    finish_reason: lastEmpty.finish_reason,
    fallback: true
  };
}

// Возвращает { dishes, low_confidence, usage, model, finish_reason, fallback }
async function analyzeImage(imageBuffer, mimeType = "image/jpeg") {
  const dataUrl = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
  return analyze({
    providers: visionChain(),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: IMAGE_PROMPT },
          { type: "image_url", image_url: { url: dataUrl, detail: "high" } }
        ]
      }
    ],
    maxTokens: 3000,
    fallbackName: "Блюдо"
  });
}

// Возвращает { dishes, low_confidence, usage, model, finish_reason, fallback }
async function analyzeText(description) {
  const text = String(description || "").slice(0, 500);
  return analyze({
    providers: textChain(),
    messages: [
      { role: "system", content: TEXT_PROMPT },
      { role: "user", content: text }
    ],
    maxTokens: 1500,
    fallbackName: text // не распозналось — берём описание пользователя как название
  });
}

module.exports = {
  analyzeImage, analyzeText, reconcileMacros, normalizeDish, modelLabel,
  parseDishes, fallbackDish, visionChain, textChain,
  IMAGE_PROMPT, TEXT_PROMPT, MODEL, VISION_MODEL, TEXT_MODEL, GEMINI_VISION_MODELS
};
