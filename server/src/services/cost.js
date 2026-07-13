// Расчёт стоимости запросов к OpenAI по модели.
// Цены USD за 1M токенов (input/output). Источник — публичный прайс OpenAI.
const PRICING = {
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "gpt-4.1": { in: 2, out: 8 },
  "gpt-4o-mini-2024-07-18": { in: 0.15, out: 0.6 }
};

const FALLBACK = { in: 0.15, out: 0.6 };

// usage: { prompt_tokens, completion_tokens }
function costUsd(model, usage) {
  const p = PRICING[model] || FALLBACK;
  const inTok = Number(usage?.prompt_tokens || 0);
  const outTok = Number(usage?.completion_tokens || 0);
  const cost = (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
  return Math.round(cost * 1e6) / 1e6; // округление до 6 знаков
}

module.exports = { costUsd, PRICING };
