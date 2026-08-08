// Расчёт стоимости запросов к OpenAI по модели.
// Цены USD за 1M токенов (input/output/cached input). Источник — публичный прайс OpenAI.
// cached — повторно присланный кусок промпта: OpenAI кэширует длинные одинаковые начала
// запросов и считает их вчетверо дешевле. У нас промпт большой и одинаковый, поэтому без
// этой строки оценка завышала расход в ~2.5 раза (сверка с Costs API: $1.42 против $0.60).
const PRICING = {
  "gpt-4o-mini": { in: 0.15, out: 0.6, cached: 0.075 },
  "gpt-4o": { in: 2.5, out: 10, cached: 1.25 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6, cached: 0.1 },
  "gpt-4.1": { in: 2, out: 8, cached: 0.5 },
  "gpt-4o-mini-2024-07-18": { in: 0.15, out: 0.6, cached: 0.075 }
};

const FALLBACK = { in: 0.15, out: 0.6, cached: 0.075 };

// usage: { prompt_tokens, completion_tokens, prompt_tokens_details: { cached_tokens } }
function costUsd(model, usage) {
  // Gemini работает на бесплатном тире Google — его запросы не тарифицируются.
  // Проверяем по префиксу, а не по списку: имена моделей меняются, а неизвестная модель
  // ушла бы в FALLBACK и рисовала бы в админке расходы, которых нет.
  if (String(model || "").startsWith("gemini")) return 0;
  const p = PRICING[model] || FALLBACK;
  const inTok = Number(usage?.prompt_tokens || 0);
  const outTok = Number(usage?.completion_tokens || 0);
  // Кэшированные токены приходят ВНУТРИ prompt_tokens, поэтому их вычитаем из полной цены,
  // а не прибавляем сверху. Если поля нет (старые ответы, Gemini) — считаем всё по полной.
  const cachedTok = Math.min(Number(usage?.prompt_tokens_details?.cached_tokens || 0), inTok);
  const freshTok = inTok - cachedTok;
  const cost = (freshTok / 1e6) * p.in + (cachedTok / 1e6) * p.cached + (outTok / 1e6) * p.out;
  return Math.round(cost * 1e6) / 1e6; // округление до 6 знаков
}

module.exports = { costUsd, PRICING };
