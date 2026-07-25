const { Telegraf } = require("telegraf");
const { message } = require("telegraf/filters");
const config = require("./config");
const db = require("./db");
const user = require("./handlers/user");
const admin = require("./handlers/admin");

// Когда заблокированному в последний раз ответили заглушкой (telegram_id -> ts).
const blockedNoticeAt = new Map();
const BLOCKED_NOTICE_MS = 10 * 60 * 1000;

function createBot() {
  const bot = new Telegraf(config.SUPPORT_BOT_TOKEN);

  // Заблокированные в основном приложении не пишут и в поддержку. База общая
  // (тот же DATABASE_URL), поэтому флаг читаем напрямую. Админов не трогаем.
  bot.use(async (ctx, next) => {
    try {
      if (!ctx.from?.id || config.isAdmin(ctx.from.id)) return next();
      const { rows } = await db.query(
        "SELECT is_blocked FROM users WHERE telegram_id = $1",
        [String(ctx.from.id)]
      );
      if (rows[0]?.is_blocked !== true) return next();
      const last = blockedNoticeAt.get(ctx.from.id) || 0;
      if (Date.now() - last > BLOCKED_NOTICE_MS) {
        blockedNoticeAt.set(ctx.from.id, Date.now());
        await ctx.reply(config.BLOCKED_TEXT).catch(() => {});
      }
    } catch (e) {
      // Сбой проверки не должен закрывать поддержку остальным.
      console.error("[support] blocked gate:", e.message);
      return next();
    }
  });

  bot.start((ctx) => (config.isAdmin(ctx.from.id) ? admin.start(ctx) : user.start(ctx)));
  bot.command("cancel", (ctx) => {
    if (config.isAdmin(ctx.from.id)) return admin.cancel(ctx);
  });

  bot.action("list", (ctx) => {
    if (!config.isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    return admin.onList(ctx);
  });
  bot.action(/^reply:(\d+)$/, (ctx) => {
    if (!config.isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    return admin.onReplyBtn(ctx);
  });
  bot.action(/^close:(\d+)$/, (ctx) => {
    if (!config.isAdmin(ctx.from.id)) return ctx.answerCbQuery();
    return admin.onCloseBtn(ctx);
  });

  const route = (ctx) => (config.isAdmin(ctx.from.id) ? admin.onMessage(ctx) : user.onMessage(ctx));
  bot.on(message("photo"), route);
  bot.on(message("text"), route);
  // Прочие типы (voice, стикеры, документы) — вежливый отказ пользователю.
  bot.on("message", (ctx) => {
    if (config.isAdmin(ctx.from.id)) {
      return ctx.reply("Поддерживаются текст и фото.");
    }
    return ctx.reply("Поддерживаются текст и фото. Опишите проблему сообщением 🙏");
  });

  // Страховочный catch, чтобы одна ошибка не валила long-polling.
  bot.catch((err, ctx) => {
    console.error(`[support] ошибка обработки ${ctx?.updateType}:`, err.message);
  });

  return bot;
}

module.exports = { createBot };
