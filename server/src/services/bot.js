const { Telegraf } = require("telegraf");
const { isChannelMember } = require("./telegram");
const db = require("../db");
const notify = require("./notify");
const channelMembership = require("./channelMembership");
const employeeReferrals = require("./employeeReferrals");
const { uniqueRefCode } = require("../utils/refcode");

const REQUIRED_CHANNEL_ID = process.env.REQUIRED_CHANNEL_ID || "";

// id пользователя в нашей базе по telegram_id (для отметки членства из колбэков бота).
async function userIdByTg(telegramId) {
  const { rows } = await db.query("SELECT id FROM users WHERE telegram_id = $1", [String(telegramId)]);
  return rows[0]?.id || null;
}

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

let bot = null;

// Клавиатура с предложением подписаться на обязательный канал.
function subscribeKeyboard() {
  const url = process.env.REQUIRED_CHANNEL_URL;
  const rows = [];
  if (url) rows.push([{ text: "📢 Подписаться на канал", url }]);
  rows.push([{ text: "✅ Я подписался", callback_data: "check_sub" }]);
  return { inline_keyboard: rows };
}

function openAppKeyboard() {
  // Тренерский инвайт идёт через startapp=tr_<code> (читается мини-аппом), реф-диплинков нет.
  return { inline_keyboard: [[{ text: "Открыть приложение", web_app: { url: CLIENT_URL } }]] };
}

// Заносит пользователя в базу при нажатии /start. Новая запись помечается
// app_opened=FALSE (в админке — «не открыл приложение»). Существующих не трогаем.
async function registerStartUser(from) {
  if (!from || !from.id) return;
  const telegramId = String(from.id);
  const name = [from.first_name, from.last_name].filter(Boolean).join(" ") || null;
  const username = from.username || null;
  const refCode = await uniqueRefCode();
  const { rows } = await db.query(
    `INSERT INTO users (telegram_id, username, name, ref_code, app_opened)
     VALUES ($1,$2,$3,$4,FALSE)
     ON CONFLICT (telegram_id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, users.username),
       name = COALESCE(EXCLUDED.name, users.name)
     RETURNING *, (xmax = 0) AS inserted`,
    [telegramId, username, name, refCode]
  );
  return rows[0];
}

function getBot() {
  if (!BOT_TOKEN) return null;
  if (bot) return bot;

  bot = new Telegraf(BOT_TOKEN);

  bot.start(async (ctx) => {
    // Заводим пользователя в базе уже на /start (app_opened=FALSE по умолчанию).
    // Если он позже откроет приложение — auth выставит app_opened=TRUE.
    // На конфликте по telegram_id обновляем лишь username/name, app_opened не трогаем.
    const user = await registerStartUser(ctx.from).catch((e) => {
      console.error("[bot] registerStartUser:", e.message);
      return null;
    });
    // Ссылка сотрудника-пиарщика: /start emp_<code>. Фиксируем переход/реферала
    // ДО проверки подписки на канал (подписка — условие подтверждения через 24 ч,
    // а не условие привязки). Fire-and-forget — /start не должен ждать.
    const empLink = /^emp_([0-9a-f]+)$/i.exec(String(ctx.payload || "").trim());
    if (empLink && user) {
      employeeReferrals.handleStartLink({ code: empLink[1].toLowerCase(), from: ctx.from, userRow: user })
        .catch((e) => console.error("[bot] emp link:", e.message));
    }
    const member = await isChannelMember(ctx.from.id);
    // Лог «Новый пользователь» уходит ТОЛЬКО когда человек подписан на канал
    // (фиксируем членство; markChannelJoined сам решит, новый это или нет).
    if (member && user) {
      channelMembership.markChannelJoined(user.id, "channel").catch((e) =>
        console.error("[bot] markChannelJoined:", e.message)
      );
    }
    if (!member) {
      await ctx.reply(
        "🔒 Чтобы пользоваться ботом, подпишись на наш канал, затем нажми «Я подписался».",
        { reply_markup: subscribeKeyboard() }
      );
      return;
    }
    await ctx.reply(
      "🥗 Добро пожаловать в Bytwise!\nФотографируй еду — узнавай КБЖУ.",
      { reply_markup: openAppKeyboard() }
    );
  });

  bot.action("check_sub", async (ctx) => {
    const member = await isChannelMember(ctx.from.id, { force: true });
    if (member) {
      // Подписка подтверждена — фиксируем членство и (если впервые) логируем нового пользователя.
      const uid = await userIdByTg(ctx.from.id).catch(() => null);
      if (uid) {
        channelMembership.markChannelJoined(uid, "channel").catch((e) =>
          console.error("[bot] markChannelJoined:", e.message)
        );
      }
      await ctx.answerCbQuery("Готово! Доступ открыт ✅");
      await ctx.reply(
        "🥗 Спасибо за подписку! Открывай приложение и считай калории.",
        { reply_markup: openAppKeyboard(null) }
      );
    } else {
      await ctx.answerCbQuery("Подписка не найдена, попробуйте ещё раз", { show_alert: true });
    }
  });

  // Апдейты участников обязательного канала (нужны права админа бота в канале +
  // allowedUpdates со "chat_member" в launch). Ловим вход/выход и держим channel_member актуальным.
  bot.on("chat_member", async (ctx) => {
    try {
      const upd = ctx.update?.chat_member;
      if (!upd) return;
      // Берём чат из самого апдейта (не из геттера ctx.chat) — надёжнее для chat_member.
      if (!REQUIRED_CHANNEL_ID || String(upd.chat?.id) !== String(REQUIRED_CHANNEL_ID)) return;
      const tgId = upd.new_chat_member?.user?.id;
      const status = upd.new_chat_member?.status;
      if (!tgId || !status) return;
      const uid = await userIdByTg(tgId);
      if (!uid) return; // в канале есть, но в боте не регистрировался — пропускаем
      if (["member", "administrator", "creator"].includes(status)) {
        await channelMembership.markChannelJoined(uid, "channel");
      } else if (["left", "kicked"].includes(status)) {
        await channelMembership.markChannelLeft(uid);
      }
    } catch (e) {
      console.error("[bot] chat_member:", e.message);
    }
  });

  bot.command("help", (ctx) =>
    ctx.reply("Отправь фото еды через приложение, и я посчитаю калории и БЖУ.")
  );

  // --- Команды сотрудников-пиарщиков. Отвечаем ТОЛЬКО активным сотрудникам:
  // всем остальным — тишина (как на любую неизвестную команду), фича не светится.

  bot.command("ref", async (ctx) => {
    try {
      const emp = await employeeReferrals.getActiveEmployeeByTg(ctx.from.id);
      if (!emp) return;
      await ctx.reply(
        `🔗 <b>Твоя личная ссылка:</b>\n${employeeReferrals.buildLink(emp.code)}\n\n` +
        `<b>Как засчитываются рефералы:</b>\n` +
        `• только НОВЫЕ люди, которых ещё не было в боте;\n` +
        `• человек должен открыть приложение и подписаться на канал;\n` +
        `• проверка через 24 часа: если он не заблокировал бота и не вышел из канала — реферал засчитан.\n\n` +
        `Статистика — /stat`,
        { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
      );
    } catch (e) {
      console.error("[bot] /ref:", e.message);
    }
  });

  bot.command("stat", async (ctx) => {
    try {
      const emp = await employeeReferrals.getActiveEmployeeByTg(ctx.from.id);
      if (!emp) return;
      const s = await employeeReferrals.statsForEmployee(emp.id);
      const row = (o) => `${o.day} / ${o.week} / ${o.month}`;
      await ctx.reply(
        `📊 <b>Твоя статистика</b>\n\n` +
        `<b>За день / 7 дней / 30 дней</b> (по Москве):\n` +
        `👆 Переходы по ссылке: ${row(s.clicks)}\n` +
        `👥 Новые рефералы: ${row(s.referrals)}\n` +
        `💳 Оплаты подписок: ${row(s.payments)}\n\n` +
        `⏳ На проверке сейчас: ${s.referrals.pending}\n\n` +
        `<b>Всего:</b>\n` +
        `👥 Рефералов: ${s.referrals.confirmed} — выплачено за ${s.referrals.paid}, ждут выплаты ${s.referrals.unpaid}\n` +
        `💳 Оплат подписок: ${s.payments.total} — выплачено за ${s.payments.paid}, ждут выплаты ${s.payments.unpaid}\n` +
        `💰 Выплачено тебе всего: ${s.payouts.paid_total} ₽`,
        { parse_mode: "HTML" }
      );
    } catch (e) {
      console.error("[bot] /stat:", e.message);
    }
  });

  return bot;
}

// Отправка файла-документа (используется для авто-бэкапа БД админам).
// source — Buffer или путь к файлу. Отправка работает без launch(), нужен лишь токен.
async function sendDocument(chatId, source, filename, caption = "") {
  const b = getBot();
  if (!b) {
    console.log(`[bot:mock] document -> ${chatId}: ${filename}`);
    return { ok: false, mock: true };
  }
  return b.telegram.sendDocument(
    chatId,
    { source, filename },
    caption ? { caption } : undefined
  );
}

// Запуск long-polling (для локалки/прод без вебхука)
async function launchBot() {
  const b = getBot();
  if (!b) {
    console.log("[bot] TELEGRAM_BOT_TOKEN не задан — бот не запущен");
    return null;
  }
  // allowedUpdates обязателен, чтобы Telegram присылал chat_member (по умолчанию он их НЕ шлёт).
  // Указав список явно, нужно перечислить и обычные апдейты, иначе они перестанут приходить.
  b.launch({ allowedUpdates: ["message", "edited_message", "callback_query", "my_chat_member", "chat_member"] })
    .then(() => console.log("[bot] launched")).catch((e) => console.error("[bot] launch error:", e.message));
  process.once("SIGINT", () => b.stop("SIGINT"));
  process.once("SIGTERM", () => b.stop("SIGTERM"));
  return b;
}

module.exports = { getBot, launchBot, sendDocument };
