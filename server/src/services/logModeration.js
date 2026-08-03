// Модерация прямо из канала логов: ответить на сообщение «.запретить» — и человек
// теряет доступ к приложению, боту и поддержке. Команды: .запретить, .разрешить, .баны.
//
// ПОЧЕМУ ЧЕРЕЗ КНОПКУ. Логи — это канал, а посты в канале анонимны: Telegram присылает
// channel_post БЕЗ поля from (есть только sender_chat = сам канал), поэтому по тексту
// команды опознать автора невозможно в принципе. Поэтому текст только ПРЕДЛАГАЕТ действие,
// а выполняется оно нажатием инлайн-кнопки: в callback_query Telegram гарантированно
// передаёт from.id нажавшего — его и сверяем с ADMIN_TELEGRAM_IDS.
const db = require("../db");
const settings = require("../utils/settings");
const channelDm = require("./channelDm");
const channelLog = require("./channelLog");
const moderation = require("./moderation");
const notify = require("./notify");
const userInvites = require("./userInvites");

const esc = channelLog.esc;

// «.запретить», «.разрешить», «.баны», «.розыгрыш» — с необязательным аргументом через пробел
// (telegram_id для бана, количество мест для розыгрыша).
const CMD_RE = /^\s*\.(запретить|разрешить|баны|розыгрыш)(?:\s+(\S+))?\s*$/i;

// Любой другой текст с точки — личное сообщение человеку, на лог которого ответили
// (Поправка №49). Команды из CMD_RE проверяются первыми и всегда в приоритете,
// поэтому написать человеку одним словом «баны» через эту команду не выйдет.
const DM_RE = /^\s*\.(?!\s)([\s\S]+?)\s*$/;

// Опечатка в команде («.запретить 123 456») формально попадает под DM_RE и ушла бы
// человеку текстом. Такие случаи разворачиваем с подсказкой по синтаксису.
const CMD_TYPO_RE = /^(запретить|разрешить|баны|розыгрыш)\b/i;

// Сколько мест показывать в «.розыгрыш» без аргумента.
const RAFFLE_DEFAULT = 6;
const RAFFLE_MAX = 30;

// Читаемая подпись человека для карточки: @username либо имя, плюс числовой id.
function label(u) {
  const name = u.username ? `@${esc(u.username)}` : esc(u.name || "Пользователь");
  return `<b>${name}</b> (id <code>${u.telegram_id}</code>)`;
}

// Кто нажал кнопку — для строчки «Кто:» в итоговом сообщении.
function actorLabel(from) {
  if (from?.username) return `@${esc(from.username)}`;
  return esc([from?.first_name, from?.last_name].filter(Boolean).join(" ") || String(from?.id || "?"));
}

// Тот ли это канал. Команды принимаем ТОЛЬКО из канала логов, заданного в админке:
// в любом другом чате бот на «.запретить» не реагирует вообще.
async function isLogChannel(chatId) {
  const configured = await settings.get("tg_log_channel_id");
  if (!configured) return false;
  return String(configured).trim() === String(chatId);
}

// Ответ в канал реплаем на команду админа.
function reply(ctx, text, extra = {}) {
  return ctx.reply(text, {
    parse_mode: "HTML",
    reply_parameters: { message_id: ctx.channelPost.message_id },
    ...extra
  }).catch((e) => console.error("[logModeration] reply:", e.message));
}

// О ком речь: либо явный telegram_id в команде, либо сообщение, на которое ответили.
async function resolveTarget(ctx, arg) {
  if (arg) {
    if (!/^\d+$/.test(arg)) return { error: "Telegram ID — это число. Например: <code>.запретить 123456789</code>" };
    const u = await moderation.findByTelegramId(arg);
    if (!u) return { error: `Пользователя с id <code>${esc(arg)}</code> нет в базе.` };
    return { user: u };
  }

  const replyTo = ctx.channelPost.reply_to_message;
  if (!replyTo) {
    return { error: "Ответьте этой командой на сообщение о нужном человеке — или укажите его Telegram ID: <code>.запретить 123456789</code>" };
  }
  const userId = await channelLog.userIdByLogMessage(ctx.chat.id, replyTo.message_id);
  if (!userId) {
    return {
      error: "Не понял, о ком это сообщение. Так бывает со старыми логами — они отправлены до появления этой команды. " +
        "Укажите Telegram ID вручную: <code>.запретить 123456789</code>"
    };
  }
  const u = await moderation.findById(userId);
  if (!u) return { error: "Этот пользователь уже удалён из базы." };
  return { user: u };
}

// Карточка подтверждения. Сама по себе ничего не меняет — только показывает кнопки.
async function askConfirm(ctx, action, u) {
  const ban = action === "ban";
  if (ban && u.is_blocked) {
    return reply(ctx, `${label(u)} уже заблокирован${u.blocked_at ? ` — с ${notify.fmtWhen(u.blocked_at)}` : ""}.`);
  }
  if (!ban && !u.is_blocked) {
    return reply(ctx, `${label(u)} не заблокирован — разблокировать нечего.`);
  }
  if (ban && await moderation.isProtected(u.id)) {
    return reply(ctx, `${label(u)} — администратор. Такой аккаунт заблокировать нельзя.`);
  }

  const text = ban
    ? `⚠️ <b>Заблокировать ${label(u)}?</b>\n\n` +
      `В базе с ${notify.fmtWhen(u.created_at)}\n` +
      `Потеряет доступ к приложению, боту и поддержке — увидит, что Bytwise недоступен в его стране. ` +
      `Записи о еде и вес сохранятся.`
    : `✅ <b>Разблокировать ${label(u)}?</b>\n\n` +
      `Заблокирован ${u.blocked_at ? notify.fmtWhen(u.blocked_at) : "—"}\n` +
      `Доступ ко всем функциям вернётся, данные на месте.`;

  return reply(ctx, text, {
    reply_markup: {
      inline_keyboard: [[
        { text: ban ? "🚫 Подтвердить" : "✅ Подтвердить", callback_data: `mod:${action}:${u.id}` },
        { text: "✖️ Отмена", callback_data: "mod:cancel" }
      ]]
    }
  });
}

// «.текст» реплаем на лог — личное сообщение человеку от лица бота (Поправка №49).
// Карточка, как и у бана, только предлагает действие: отправка — по кнопке,
// потому что в channel_post нет автора и проверить права по тексту невозможно.
async function askDm(ctx, text) {
  if (CMD_TYPO_RE.test(text)) {
    return reply(
      ctx,
      "❌ Похоже на команду с лишними словами. Команды пишутся так: <code>.запретить</code>, " +
      "<code>.разрешить</code>, <code>.баны</code>, <code>.розыгрыш 10</code> — не больше одного аргумента.\n\n" +
      "Если это правда текст для человека — начните его с другого слова."
    );
  }

  const replyTo = ctx.channelPost.reply_to_message;
  if (!replyTo) {
    return reply(ctx, "❌ Ответьте этим сообщением на лог нужного человека — иначе я не пойму, кому его отправить.");
  }
  const userId = await channelLog.userIdByLogMessage(ctx.chat.id, replyTo.message_id);
  if (!userId) {
    return reply(ctx, "❌ Не понял, о ком это сообщение. Так бывает со старыми логами — ответьте на более свежее сообщение об этом человеке.");
  }
  const u = await channelDm.recipient(userId);
  if (!u) return reply(ctx, "❌ Этот пользователь уже удалён из базы.");
  if (u.is_blocked) return reply(ctx, `❌ ${label(u)} заблокирован — сообщения ему не уходят.`);
  if (text.length > channelDm.MAX_LEN) {
    return reply(ctx, `❌ Слишком длинно: ${text.length} символов, а Telegram принимает не больше ${channelDm.MAX_LEN}.`);
  }

  const draft = await channelDm.createDraft(u.id, text);
  return reply(
    ctx,
    `✉️ <b>Отправить сообщение ${label(u)}?</b>\n\n` +
    `Придёт обычным сообщением от бота — без упоминания, что это админ.` +
    (u.tg_unreachable ? `\n\n⚠️ Человек ранее заблокировал бота — сообщение может не дойти.` : "") +
    `\n\n<blockquote>${esc(text)}</blockquote>`,
    {
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[
          { text: "✉️ Отправить", callback_data: `dm:send:${draft.id}` },
          { text: "✖️ Отмена", callback_data: `dm:cancel:${draft.id}` }
        ]]
      }
    }
  );
}

// Список текущих банов. Только чтение — подтверждение не нужно.
async function showBans(ctx) {
  const rows = await moderation.listBlocked(50);
  const total = await moderation.countBlocked();
  if (!total) return reply(ctx, "🚫 <b>Заблокированные</b>\n\nСписок пуст.");

  const lines = rows.map((u, i) => {
    const name = u.username ? `@${esc(u.username)}` : esc(u.name || "Пользователь");
    const when = u.blocked_at ? notify.fmtWhen(u.blocked_at) : "дата неизвестна";
    return `${i + 1}. ${name} — <code>${u.telegram_id}</code>\n    ${when}`;
  });
  const tail = total > rows.length ? `\n\n…и ещё ${total - rows.length}. Всего: ${total}.` : `\n\nВсего: ${total}.`;
  return reply(ctx, `🚫 <b>Заблокированные</b>\n\n${lines.join("\n")}${tail}`);
}

// Текст поста о розыгрыше. Вынесен из showRaffle отдельно и чистым: этот формат
// копируют в публичный канал как есть, поэтому он покрыт тестом.
// Первые три места идут под шапкой «Топ-3», остальные — за чертой, нумерация сквозная.
function formatRaffle(rows) {
  // Имя — ссылкой на профиль, если есть @username (без него профиль по имени не открыть).
  const line = (u, i) => {
    const name = esc(u.name || u.username || "Без имени");
    const who = u.username ? `<a href="https://t.me/${esc(u.username)}">${name}</a>` : name;
    return `${i + 1}. ${who} · ID <code>${u.telegram_id}</code> — ${u.invited} / ${u.confirmed}`;
  };

  const head = rows.slice(0, 3).map((u, i) => line(u, i));
  const tail = rows.slice(3).map((u, i) => line(u, i + 3));

  return (
    `На данный момент следующие ТОП-${rows.length} участников\n\n` +
    `🔫 Топ-${head.length} (приглашено / зачтено):\n` +
    head.join("\n") +
    (tail.length ? `\n_________________________________\n${tail.join("\n")}` : "")
  );
}

// Топ участников розыгрыша «Пригласи друга». Только чтение — подтверждение не нужно,
// как и у «.баны»: команда работает исключительно в канале логов, а туда пишут только админы.
async function showRaffle(ctx, arg) {
  if (arg && !/^\d+$/.test(arg)) {
    return reply(ctx, "❌ Укажите число участников: <code>.розыгрыш 10</code> (или просто <code>.розыгрыш</code>).");
  }
  const limit = Math.min(RAFFLE_MAX, Math.max(1, Number(arg) || RAFFLE_DEFAULT));
  const rows = await userInvites.leaderboard(limit);
  if (!rows.length) {
    return reply(ctx, "🔫 <b>Розыгрыш</b>\n\nПока никто никого не пригласил.");
  }
  // Превью профилей отключаем — иначе к посту прилипнет карточка первого участника.
  return reply(ctx, formatRaffle(rows), { link_preview_options: { is_disabled: true } });
}

// Пост в канале логов. Не команда — молча выходим (в канал пишут и люди, и сам бот).
async function onChannelPost(ctx) {
  try {
    const text = ctx.channelPost?.text;
    if (!text) return;
    const m = CMD_RE.exec(text);
    // Не команда — может быть личным сообщением человеку: «.Привет» реплаем на лог.
    if (!m) {
      const dm = DM_RE.exec(text);
      if (!dm) return;
      if (!(await isLogChannel(ctx.chat.id))) return;
      return askDm(ctx, dm[1]);
    }
    if (!(await isLogChannel(ctx.chat.id))) return;

    const cmd = m[1].toLowerCase();
    if (cmd === "баны") return showBans(ctx);
    if (cmd === "розыгрыш") return showRaffle(ctx, m[2]);

    const { user, error } = await resolveTarget(ctx, m[2]);
    if (error) return reply(ctx, `❌ ${error}`);
    return askConfirm(ctx, cmd === "запретить" ? "ban" : "unban", user);
  } catch (e) {
    console.error("[logModeration] channel_post:", e.message);
  }
}

// Нажатие кнопки — здесь и происходит собственно бан/разбан.
// ctx.from.id тут настоящий (в отличие от channel_post), его и проверяем.
async function onModAction(ctx) {
  try {
    const data = ctx.callbackQuery?.data || "";
    const isAdmin = db.getAdminIds().includes(String(ctx.from?.id));
    if (!isAdmin) {
      return ctx.answerCbQuery("❌ У вас нет прав на это действие", { show_alert: true });
    }

    if (data === "mod:cancel") {
      await ctx.editMessageText("✖️ Отменено.", { parse_mode: "HTML" }).catch(() => {});
      return ctx.answerCbQuery("Отменено");
    }

    const m = /^mod:(ban|unban):(\d+)$/.exec(data);
    if (!m) return ctx.answerCbQuery();
    const action = m[1];
    const userId = Number(m[2]);

    const u = await moderation.findById(userId);
    if (!u) {
      await ctx.editMessageText("❌ Пользователь уже удалён из базы.", { parse_mode: "HTML" }).catch(() => {});
      return ctx.answerCbQuery();
    }
    // Перепроверяем: между показом карточки и нажатием всё могло измениться.
    if (action === "ban" && await moderation.isProtected(userId)) {
      await ctx.editMessageText(`❌ ${label(u)} — администратор, заблокировать нельзя.`, { parse_mode: "HTML" }).catch(() => {});
      return ctx.answerCbQuery("Нельзя заблокировать админа", { show_alert: true });
    }

    if (action === "ban") await moderation.blockUser(userId, { byTelegramId: ctx.from.id });
    else await moderation.unblockUser(userId, { byTelegramId: ctx.from.id });

    // Переписываем карточку в итог — заодно пропадает клавиатура, повторно не нажать.
    const done = action === "ban"
      ? `🚫 ${label(u)} заблокирован`
      : `✅ ${label(u)} разблокирован`;
    await ctx.editMessageText(
      `${done}\n\nКто: ${actorLabel(ctx.from)} · ${notify.fmtWhen()}`,
      { parse_mode: "HTML" }
    ).catch((e) => console.error("[logModeration] editMessageText:", e.message));
    return ctx.answerCbQuery(action === "ban" ? "Заблокирован" : "Разблокирован");
  } catch (e) {
    console.error("[logModeration] action:", e.message);
    return ctx.answerCbQuery("Не получилось — попробуйте ещё раз", { show_alert: true }).catch(() => {});
  }
}

// Нажатие кнопки под карточкой личного сообщения — здесь оно и уходит человеку.
// Права проверяем по ctx.from.id: в callback_query он настоящий.
async function onDmAction(ctx) {
  try {
    const m = /^dm:(send|cancel):(\d+)$/.exec(ctx.callbackQuery?.data || "");
    if (!m) return ctx.answerCbQuery();
    if (!db.getAdminIds().includes(String(ctx.from?.id))) {
      return ctx.answerCbQuery("❌ У вас нет прав на это действие", { show_alert: true });
    }
    const id = Number(m[2]);

    if (m[1] === "cancel") {
      await channelDm.cancel(id, ctx.from.id);
      await ctx.editMessageText(`✖️ Отправка отменена.\n\nКто: ${actorLabel(ctx.from)} · ${notify.fmtWhen()}`, {
        parse_mode: "HTML"
      }).catch(() => {});
      return ctx.answerCbQuery("Отменено");
    }

    const actor = await moderation.findByTelegramId(ctx.from.id);
    const res = await channelDm.send(id, { byTelegramId: ctx.from.id, actorUserId: actor?.id || null });

    // Кто-то уже нажал кнопку раньше — карточку не трогаем, чтобы не затереть итог.
    if (res.busy) return ctx.answerCbQuery("Это сообщение уже обработано", { show_alert: true });

    if (!res.ok) {
      await ctx.editMessageText(
        `❌ Не отправлено: ${esc(res.error || "Telegram не принял сообщение")}\n\n` +
        `Кто: ${actorLabel(ctx.from)} · ${notify.fmtWhen()}`,
        { parse_mode: "HTML" }
      ).catch(() => {});
      return ctx.answerCbQuery("Не отправлено", { show_alert: true });
    }

    // Переписываем карточку в итог — заодно пропадает клавиатура, повторно не нажать.
    await ctx.editMessageText(
      `✉️ Отправлено ${label(res.user)}\n\n` +
      `<blockquote>${esc(res.draft.text)}</blockquote>\n\n` +
      `Кто: ${actorLabel(ctx.from)} · ${notify.fmtWhen()}`,
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    ).catch((e) => console.error("[logModeration] editMessageText:", e.message));
    return ctx.answerCbQuery("Отправлено");
  } catch (e) {
    console.error("[logModeration] dm action:", e.message);
    return ctx.answerCbQuery("Не получилось — попробуйте ещё раз", { show_alert: true }).catch(() => {});
  }
}

module.exports = { onChannelPost, onModAction, onDmAction, formatRaffle, CMD_RE, DM_RE };
