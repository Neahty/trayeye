const { isTrainer } = require("../utils/subscription");

// Требует активную подписку типа trainer
module.exports = async function checkTrainer(req, res, next) {
  try {
    if (await isTrainer(req.user.id)) return next();
    return res.status(403).json({ error: "trainer_subscription_required" });
  } catch (err) {
    next(err);
  }
};
