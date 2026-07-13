const { Telegraf } = require("telegraf");
const { message } = require("telegraf/filters");
const config = require("./config");
const user = require("./handlers/user");
const admin = require("./handlers/admin");

function createBot() {
  const bot = new Telegraf(config.SUPPORT_BOT_TOKEN);

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
