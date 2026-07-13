const db = require("../db");

// Возвращает активную (не истёкшую) подписку пользователя или null
async function getActiveSubscription(userId) {
  const { rows } = await db.query(
    `SELECT * FROM subscriptions
     WHERE user_id = $1 AND status = 'active' AND expires_at > NOW()
     ORDER BY expires_at DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || null;
}

async function hasActiveSubscription(userId) {
  return Boolean(await getActiveSubscription(userId));
}

async function isTrainer(userId) {
  const sub = await getActiveSubscription(userId);
  return Boolean(sub && sub.type === "trainer");
}

// Тренер пользователя, если он клиент тренера с АКТИВНОЙ trainer-подпиской. Иначе null.
async function getActiveTrainer(clientId) {
  const { rows } = await db.query(
    `SELECT u.id, u.name, u.username, u.telegram_id
       FROM trainer_clients tc
       JOIN users u ON u.id = tc.trainer_id
       JOIN subscriptions s ON s.user_id = tc.trainer_id
        AND s.type = 'trainer' AND s.status = 'active' AND s.expires_at > NOW()
      WHERE tc.client_id = $1
      LIMIT 1`,
    [clientId]
  );
  return rows[0] || null;
}

// Доступ к функциям: своя активная подписка ИЛИ доступ от активного тренера.
async function hasEffectiveAccess(userId) {
  if (await hasActiveSubscription(userId)) return true;
  return Boolean(await getActiveTrainer(userId));
}

module.exports = { getActiveSubscription, hasActiveSubscription, isTrainer, getActiveTrainer, hasEffectiveAccess };
