// Telegram-бот TrayEye (@TrayEye_bot). Отдельный процесс: systemd trayeye-bot, `npm run bot`.
//
// Без привязки бот первым делом предлагает привязать школу: QR из кабинета открывает
// бота с кодом (/start <код>), либо код из 6 символов присылают руками.
// Роли: повар - присылает фото подносов; директор и комбинат - сводка «Сегодня»
// и уведомления из кабинета (директор тоже может прислать фото).
// Telegram с РФ-сервера медленный, поэтому ходим через тот же прокси в Лондоне, что и ИИ.

require("../env");
const axios = require("axios");
const { Telegraf, Markup } = require("telegraf");
const { HttpsProxyAgent } = require("https-proxy-agent");
const db = require("../db");
const telegram = require("../services/telegram");
const camera = require("../services/camera");
const data = require("../services/schoolData");
const events = require("../services/events");
const { schoolOverview, kombinatOverview } = require("../services/overview");
const { today } = require("../utils/dates");
const texts = require("./texts");
const { TrayQueue } = require("./trayQueue");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PROXY_URL = process.env.TELEGRAM_PROXY_URL || process.env.AI_PROXY_URL || "";
const NOTIFY_EVERY_MS = 60 * 1000;
const MAX_PHOTO_BYTES = 15 * 1024 * 1024;
// Защита от перебора кодов: не больше 5 попыток за 10 минут с одного чата.
const CODE_ATTEMPTS = 5;
const CODE_WINDOW_MS = 10 * 60 * 1000;

const BTN_TODAY = "📊 Сегодня";
const BTN_HELP = "❓ Помощь";
const BTN_UNLINK = "🔓 Отвязать";

const agent = PROXY_URL ? new HttpsProxyAgent(PROXY_URL) : undefined;
const attempts = new Map();

function allowCodeAttempt(chatId) {
  const now = Date.now();
  const recent = (attempts.get(chatId) || []).filter((t) => now - t < CODE_WINDOW_MS);
  recent.push(now);
  attempts.set(chatId, recent);
  return recent.length <= CODE_ATTEMPTS;
}

function displayName(from) {
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ");
  return from?.username ? `${name} (@${from.username})`.trim() : name || null;
}

function menuFor(chat) {
  const rows = chat.role === "cook" ? [[BTN_HELP, BTN_UNLINK]] : [[BTN_TODAY], [BTN_HELP, BTN_UNLINK]];
  return Markup.keyboard(rows).resize();
}

const linkButton = Markup.inlineKeyboard([Markup.button.callback("🔗 Привязать школу", "link")]);

async function currentChat(ctx) {
  return telegram.chatInfo(db, ctx.chat.id);
}

async function askToLink(ctx) {
  await ctx.reply(texts.welcome(), linkButton);
}

async function bind(ctx, code) {
  if (!allowCodeAttempt(ctx.chat.id)) return ctx.reply("Слишком много попыток. Подождите 10 минут.");
  const chat = await telegram.redeemCode(code, { chatId: ctx.chat.id, name: displayName(ctx.from) });
  if (!chat) {
    console.log(`[bot] чат ${ctx.chat.id}: код не подошёл`);
    return ctx.reply(texts.wrongCode());
  }
  console.log(`[bot] чат ${ctx.chat.id} привязан: ${chat.role}, ${chat.school_name || chat.kombinat_name}`);
  attempts.delete(ctx.chat.id);
  return ctx.reply(texts.linked(chat), menuFor(chat));
}

async function sendSummary(ctx, chat) {
  const date = today();
  console.log(`[bot] чат ${chat.chat_id}: сводка «Сегодня» (${chat.role})`);
  if (chat.role === "director") {
    return ctx.reply(texts.directorSummary(chat, await schoolOverview(chat.school_id, date)), { link_preview_options: { is_disabled: true } });
  }
  if (chat.role === "kombinat") {
    const overview = await kombinatOverview(await data.schoolsOf(chat.kombinat_id), date);
    return ctx.reply(texts.kombinatSummary(chat, date, overview), { link_preview_options: { is_disabled: true } });
  }
  return ctx.reply(texts.roleHelp(chat));
}

// ---------- Фото подносов ----------

let bot = null;

function replyTo(chatId, messageId, text) {
  return bot.telegram.sendMessage(chatId, text, {
    reply_parameters: { message_id: messageId, allow_sending_without_reply: true }
  }).catch((err) => console.error("[bot] ответ на фото:", err.message));
}

// Пачка подносов с остатками одной школы -> ИИ одним запросом -> ответ на каждое фото.
async function flushTrays(schoolId, items) {
  try {
    const date = today();
    const menu = await data.dishDays([schoolId], date, date);
    if (!menu.length) {
      await Promise.all(items.map((it) => replyTo(it.chatId, it.messageId, "На сегодня у школы нет меню - добавьте его на сайте, тогда подносы засчитаются.")));
      return;
    }
    const { trays, aiRequests } = await camera.recordTrays({
      schoolId, date, menu, trays: items.map((it) => it.tray), source: "upload"
    });
    const saved = trays.reduce((n, t) => n + t.trays.length, 0);
    console.log(`[bot] школа ${schoolId}: фото ${items.length}, подносов записано ${saved}, запросов к ИИ ${aiRequests}, не разобрано ${trays.filter((t) => t.error).length}`);
    await Promise.all(trays.map((result, i) => replyTo(items[i].chatId, items[i].messageId, texts.trayResult(result, menu))));
    if (saved) {
      await events.record(db, {
        kombinatId: items[0].kombinatId,
        schoolId,
        audience: "kombinat",
        kind: "tray_scanned",
        text: `${items[0].schoolName}: повар прислал подносов - ${saved} за ${events.dayLabel(date)}`,
        link: `/kombinat/schools/${schoolId}`
      });
    }
  } catch (err) {
    console.error("[bot] пачка подносов:", err.message);
    await Promise.all(items.map((it) => replyTo(it.chatId, it.messageId, texts.trayResult({ error: err.message }))));
  }
}

const queue = new TrayQueue({
  flush: flushTrays,
  batchSize: Math.min(16, Math.max(1, Number(process.env.CAMERA_AI_BATCH) || 8)),
  waitMs: Number(process.env.BOT_BATCH_WAIT_MS) || 45000
});

async function downloadFile(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const { data: body } = await axios.get(link.href, {
    responseType: "arraybuffer", timeout: 30000, maxContentLength: MAX_PHOTO_BYTES,
    ...(agent ? { httpsAgent: agent, proxy: false } : {})
  });
  return Buffer.from(body);
}

async function handlePhoto(ctx, fileId) {
  const chat = await currentChat(ctx);
  if (!chat) return askToLink(ctx);
  if (!chat.school_id) return ctx.reply("Фото подносов присылает повар или директор школы. Комбинату доступна сводка «Сегодня».");

  const messageId = ctx.message.message_id;
  const date = today();
  const menu = await data.dishDays([chat.school_id], date, date);
  if (!menu.length) return replyTo(chat.chat_id, messageId, "На сегодня у школы нет меню - добавьте его на сайте, тогда подносы засчитаются.");

  const buffer = await downloadFile(ctx, fileId);
  // Сначала локальная модель (без токенов): есть ли на фото посуда и осталось ли в ней что-то.
  // Делить фото на подносы она не умеет (подносы на столе без дообучения не различает),
  // поэтому подносы с едой считает Gemini - по всему фото целиком.
  const groups = await camera.analyzeImage(buffer);
  if (groups && !groups.length) {
    console.log(`[bot] чат ${chat.chat_id}: на фото нет посуды`);
    return replyTo(chat.chat_id, messageId, "🤔 Не вижу тарелок. Снимите подносы сверху или под небольшим углом, чтобы посуда попала в кадр.");
  }
  if (groups && groups.every((g) => g.is_empty)) {
    console.log(`[bot] чат ${chat.chat_id}: фото, посуда пустая - без ИИ`);
    const { trays: results } = await camera.recordTrays({ schoolId: chat.school_id, date, menu, trays: groups, source: "upload" });
    return replyTo(chat.chat_id, messageId, texts.trayResult({ is_empty: true, trays: results.flatMap((r) => r.trays) }, menu));
  }

  console.log(`[bot] чат ${chat.chat_id}: фото с едой - в очередь к ИИ`);
  await replyTo(chat.chat_id, messageId, "⏳ Вижу еду. Отправлю в нейросеть вместе с другими фото - ответ придёт в течение минуты.");
  queue.add(chat.school_id, {
    tray: { is_empty: false, items: [], crop_jpeg: buffer.toString("base64") },
    chatId: chat.chat_id, messageId, kombinatId: chat.kombinat_id, schoolName: chat.school_name
  });
  return null;
}

// ---------- Уведомления из кабинета ----------

let notifying = false;
async function pushNotifications() {
  if (notifying) return;
  notifying = true;
  try {
    for (const chat of await telegram.notifiableChats()) {
      for (const ev of await telegram.takeNewEvents(chat)) {
        try {
          await bot.telegram.sendMessage(chat.chat_id, texts.notification(ev), { link_preview_options: { is_disabled: true } });
        } catch (err) {
          // 403 - человек заблокировал бота: отвязываем, чтобы не стучаться впустую.
          if (err.response?.error_code === 403) await telegram.unlinkSelf(chat.chat_id);
          else console.error("[bot] уведомление:", err.message);
          break;
        }
      }
    }
  } catch (err) {
    console.error("[bot] уведомления:", err.message);
  } finally {
    notifying = false;
  }
}

// ---------- Сборка бота ----------

function createBot(token) {
  const b = new Telegraf(token, { telegram: agent ? { agent } : {} });

  // Только личные сообщения: в группах бот молчит.
  b.use((ctx, next) => (ctx.chat?.type === "private" || ctx.callbackQuery ? next() : undefined));

  b.start(async (ctx) => {
    const code = telegram.normalizeCode(ctx.payload);
    if (code) return bind(ctx, code);
    const chat = await currentChat(ctx);
    return chat ? ctx.reply(texts.home(chat), menuFor(chat)) : askToLink(ctx);
  });

  b.action("link", async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.reply(texts.askCode());
  });

  const todayCmd = async (ctx) => {
    const chat = await currentChat(ctx);
    return chat ? sendSummary(ctx, chat) : askToLink(ctx);
  };
  b.command("today", todayCmd);
  b.hears(BTN_TODAY, todayCmd);

  const help = async (ctx) => {
    const chat = await currentChat(ctx);
    return chat ? ctx.reply(texts.home(chat), menuFor(chat)) : askToLink(ctx);
  };
  b.command("help", help);
  b.hears(BTN_HELP, help);

  const unlink = async (ctx) => {
    await telegram.unlinkSelf(ctx.chat.id);
    await ctx.reply("Чат отвязан от кабинета.", Markup.removeKeyboard());
    return askToLink(ctx);
  };
  b.command("unlink", unlink);
  b.hears(BTN_UNLINK, unlink);

  b.on("photo", (ctx) => handlePhoto(ctx, ctx.message.photo[ctx.message.photo.length - 1].file_id));
  b.on("document", (ctx) => {
    const doc = ctx.message.document;
    if (!/^image\/(jpeg|png|webp)$/.test(doc.mime_type || "")) return ctx.reply("Пришлите фото подноса картинкой (jpg или png).");
    if (doc.file_size > MAX_PHOTO_BYTES) return ctx.reply("Фото слишком большое.");
    return handlePhoto(ctx, doc.file_id);
  });

  b.on("text", async (ctx) => {
    const code = telegram.normalizeCode(ctx.message.text);
    // Код принимаем и от привязанного чата: так можно перепривязаться к другой школе или роли.
    if (code) return bind(ctx, code);
    const chat = await currentChat(ctx);
    return chat ? ctx.reply(texts.home(chat), menuFor(chat)) : askToLink(ctx);
  });

  b.catch(async (err, ctx) => {
    console.error("[bot] ошибка:", err.message);
    await ctx.reply("Что-то пошло не так. Попробуйте ещё раз.").catch(() => {});
  });
  return b;
}

async function main() {
  if (!TOKEN) {
    console.error("[bot] TELEGRAM_BOT_TOKEN не задан - бот не запущен");
    process.exit(1);
  }
  await db.migrate();
  bot = createBot(TOKEN);
  await bot.telegram.setMyCommands([
    { command: "today", description: "Сводка за сегодня" },
    { command: "help", description: "Что умеет бот" },
    { command: "unlink", description: "Отвязать чат от кабинета" }
  ]);
  const timer = setInterval(pushNotifications, NOTIFY_EVERY_MS);
  const stop = async (signal) => {
    clearInterval(timer);
    await queue.flushAll().catch(() => {});
    bot.stop(signal);
    await db.pool.end().catch(() => {});
  };
  process.once("SIGINT", () => stop("SIGINT"));
  process.once("SIGTERM", () => stop("SIGTERM"));
  console.log(`[bot] запускаю @${telegram.botUsername() || "?"}${PROXY_URL ? " через прокси" : ""}`);
  await bot.launch({ allowedUpdates: ["message", "callback_query"] });
}

if (require.main === module) {
  main().catch((err) => {
    console.error("[bot] не запустился:", err.message);
    process.exit(1);
  });
}

module.exports = { createBot };
