// Запись обращений к OpenAI в таблицу ai_usage.
const db = require("../db");
const { costUsd } = require("./cost");

// params: { userId, scanId, kind, model, usage, latencyMs, status, error }
async function record({ userId, scanId = null, kind, model, usage, latencyMs, status = "ok", error = null }) {
  try {
    const u = usage || {};
    const cost = costUsd(model, u);
    await db.query(
      `INSERT INTO ai_usage
        (user_id, scan_id, kind, model, prompt_tokens, completion_tokens, total_tokens, cost_usd, latency_ms, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        userId || null,
        scanId,
        kind,
        model,
        Math.round(Number(u.prompt_tokens) || 0),
        Math.round(Number(u.completion_tokens) || 0),
        Math.round(Number(u.total_tokens) || 0),
        cost,
        latencyMs != null ? Math.round(latencyMs) : null,
        status,
        error ? String(error).slice(0, 500) : null
      ]
    );
  } catch (err) {
    console.error("[aiUsage] record failed:", err.message);
  }
}

module.exports = { record };
