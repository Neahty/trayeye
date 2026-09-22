import { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import WebApp from "@twa-dev/sdk";
import { Profile, Settings, MyTrainer, assetUrl } from "../api";
import { useApp } from "../AppContext";
import { useUI } from "../ui/UIProvider";
import { Ic } from "../components/icons";
import { applyTheme, ACCENTS, DEFAULT_ACCENT } from "../lib/theme";
import { TIMEZONES, tzLabel, DEFAULT_TZ } from "../lib/timezones";
import { subBadge, subName } from "../lib/sub";
import { weightUnit, heightUnit, weightToDisplay, weightFromDisplay, heightToDisplay, heightFromDisplay, fmtWeight, fmtHeight } from "../lib/units";

// Уровень активности (5-уровневая шкала) - производный от числа тренировок, только для отображения.
const ACTIVITY_LABEL = {
  sedentary: "Сидячий",
  light: "Лёгкая",
  moderate: "Умеренная",
  high: "Высокая",
  very_high: "Очень высокая",
  // легаси-значения старых профилей
  low: "Низкая"
};
const GOAL_LABEL = { loss: "Похудение", maintain: "Поддержание", gain: "Набор массы" };
const GENDERS = [{ value: "male", label: "Мужской" }, { value: "female", label: "Женский" }];
// Темп достижения цели - влияет на дефицит/профицит калорий (см. server/utils/calories.js).
const PACE_LABEL = { slow: "Спокойный", mid: "Оптимальный", fast: "Быстрый" };
const PACE_OPTIONS = [
  { value: "fast", label: "Быстрый темп" },
  { value: "mid", label: "Оптимальный (рекомендуем)" },
  { value: "slow", label: "Спокойный темп" }
];

// Редактор ручной нормы КБЖУ (показывается в custom-шите). Поля заранее заполнены текущими
// (авто-)значениями; «Вернуть автоматический расчёт» доступен, если норма задана вручную.
function GoalsEditor({ initial, manual, onSave, onAuto }) {
  const [g, setG] = useState({
    daily_calories: initial.daily_calories ?? "",
    daily_protein: initial.daily_protein != null ? Math.round(Number(initial.daily_protein)) : "",
    daily_fat: initial.daily_fat != null ? Math.round(Number(initial.daily_fat)) : "",
    daily_carbs: initial.daily_carbs != null ? Math.round(Number(initial.daily_carbs)) : ""
  });
  const [busy, setBusy] = useState(false);
  const field = (k, label) => (
    <div style={{ flex: 1, minWidth: 70 }}>
      <label style={{ fontSize: 12.5, color: "var(--text-2)", fontWeight: 600, marginLeft: 4 }}>{label}</label>
      <input className="sheet-input" type="number" inputMode="numeric" value={g[k]} placeholder="-"
        onChange={(e) => setG((p) => ({ ...p, [k]: e.target.value }))} style={{ marginTop: 6 }} />
    </div>
  );
  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        daily_calories: Number(g.daily_calories) || null,
        daily_protein: Number(g.daily_protein) || null,
        daily_fat: Number(g.daily_fat) || null,
        daily_carbs: Number(g.daily_carbs) || null
      });
    } finally { setBusy(false); }
  };
  const auto = async () => { setBusy(true); try { await onAuto(); } finally { setBusy(false); } };
  return (
    <div>
      <h3 className="sheet-h">Моя норма КБЖУ</h3>
      <p className="sheet-sub">Можно вписать свои значения. По умолчанию норма считается автоматически по вашим данным.</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {field("daily_calories", "Ккал")}
        {field("daily_protein", "Белки, г")}
        {field("daily_fat", "Жиры, г")}
        {field("daily_carbs", "Углеводы, г")}
      </div>
      <button className="sheet-btn" disabled={busy} onClick={save} style={{ marginTop: 14 }}>Сохранить</button>
      {manual && (
        <button className="sheet-btn ghost" disabled={busy} onClick={auto} style={{ marginTop: 8 }}>Вернуть автоматический расчёт</button>
      )}
    </div>
  );
}

function ListRow({ icon, label, value, danger, last, onClick, control }) {
  return (
    <button className={"list-row" + (last ? " last" : "")} onClick={onClick}>
      <span className="list-ic" style={danger ? { color: "var(--red)", background: "color-mix(in srgb, var(--red) 12%, transparent)" } : null}>
        <Ic name={icon} size={20} sw={1.8} />
      </span>
      <span style={{ flex: 1, textAlign: "left", fontWeight: 600, fontSize: 16.5, color: danger ? "var(--red)" : "var(--text)" }}>{label}</span>
      {value && <span style={{ fontSize: 16, fontWeight: 600, color: "var(--text-2)" }}>{value}</span>}
      {control}
      {!control && onClick && <Ic name="chevronRight" size={18} sw={2.2} style={{ color: "var(--text-3)" }} />}
    </button>
  );
}

function SectionCard({ title, children }) {
  return (
    <div style={{ marginTop: 18 }}>
      {title && <div style={{ fontSize: 18, fontWeight: 800, margin: "0 4px 10px" }}>{title}</div>}
      <div className="card" style={{ overflow: "hidden", padding: "4px 0" }}>{children}</div>
    </div>
  );
}

// Инициалы из имени (для запасного аватара, когда фото недоступно вовсе).
function initialsOf(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const s = (parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : "");
  return s.toUpperCase();
}

// Аватар с цепочкой запасных вариантов:
//   загруженное фото → кэш фото Telegram (с нашего сервера) → «живой» photo_url Telegram → инициалы.
// Если очередной источник не открылся (напр. файл не перенесён при миграции БД или ссылка
// Telegram истекла), onError переключает на следующий кандидат - «битой» картинки не будет,
// а в самом конце всегда показываются инициалы, поэтому аватар есть всегда.
function Avatar({ sources = [], name, size, iconSize }) {
  const candidates = sources.filter(Boolean);
  const [idx, setIdx] = useState(0);
  const src = candidates[idx];
  const initials = initialsOf(name);
  return (
    <div className="photo-slot" style={{ width: size, height: size, borderRadius: "50%", flex: `0 0 ${size}px` }}>
      {src
        ? <img src={src} alt="" onError={() => setIdx((i) => i + 1)} />
        : initials
          ? <span style={{ fontWeight: 800, fontSize: size * 0.4, color: "var(--text-2)", lineHeight: 1 }}>{initials}</span>
          : <Ic name="user" size={iconSize} sw={1.6} style={{ color: "var(--text-3)" }} />}
    </div>
  );
}

function Toggle({ on, onClick }) {
  return (
    <button onClick={onClick} className={"tgl" + (on ? " on" : "")}
      style={{ width: 52, height: 31, borderRadius: 16, background: on ? "var(--primary)" : "var(--track)", position: "relative", transition: "background .25s", flex: "0 0 auto" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 24 : 3, width: 25, height: 25, borderRadius: "50%", background: "#fff", boxShadow: "0 2px 5px rgba(0,0,0,.25)", transition: "left .25s cubic-bezier(.3,1.4,.5,1)" }} />
    </button>
  );
}

export default function ProfilePage() {
  const { profile, reload } = useApp();
  const ui = useUI();
  const navigate = useNavigate();
  const fileRef = useRef();

  const [pub, setPub] = useState(null);
  useEffect(() => { Settings.public().then((d) => setPub(d || {})).catch(() => {}); }, []);
  const links = pub?.support_links;
  const reviewsUrl = pub?.reviews_url || "";

  // Экран редактирования профиля (имя, фото, «Мои данные», «Норма КБЖУ») - отдельный
  // подэкран, открывается кнопкой «Изм.». Основной экран остаётся чистым.
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState("");

  const u = profile?.user || {};
  const sub = profile?.subscription;
  const trial = profile?.trial;
  const units = u.units || "metric";
  const uW = weightUnit(units);   // "кг" | "фунт"
  const uH = heightUnit(units);   // "см" | "in"
  const theme = u.theme || "light";
  const tz = u.timezone || DEFAULT_TZ;
  const accent = Array.isArray(u.accent) ? u.accent : DEFAULT_ACCENT;
  const notif = u.notifications_enabled !== false;
  const isTrainer = profile?.is_trainer;
  const myTrainer = profile?.trainer;
  // PRO-доступ: своя активная подписка, активный пробный ИЛИ доступ от тренера (клиент тренера).
  const isPro = sub?.status === "active" || trial?.active || Boolean(myTrainer);

  const disconnectTrainer = () => ui.sheet({
    type: "info", title: "Отключить тренера?",
    body: "Вы перестанете быть клиентом тренера и потеряете доступ, если у вас нет своей подписки. Свои цели КБЖУ снова сможете менять сами.",
    actionLabel: "Отключить",
    onAction: async () => {
      try { await MyTrainer.disconnect(); await reload(); ui.toast("Тренер отключён", "check"); }
      catch { ui.toast("Не удалось отключить"); }
    },
    secondaryLabel: "Отмена"
  });

  const update = async (patch, msg) => {
    await Profile.update(patch);
    await reload();
    if (patch.theme || patch.accent) applyTheme(patch.theme || theme, patch.accent || accent);
    if (msg) ui.toast(msg, "check");
  };

  const editGender = () => ui.sheet({ type: "options", title: "Пол", value: u.gender, options: GENDERS,
    onPick: (v) => update({ gender: v }, "Сохранено") });
  const editAge = () => ui.sheet({ type: "stepper", title: "Возраст", value: u.age || 25, min: 10, max: 99, unit: "лет",
    onSave: (v) => update({ age: v }, "Сохранено") });
  // Рост/вес редактируются в единицах пользователя (imperial - дюймы/фунты), в БД сохраняется метрика.
  const editHeight = () => ui.sheet({ type: "stepper", title: "Рост", value: heightToDisplay(u.height || 175, units), min: heightToDisplay(120, units), max: heightToDisplay(220, units), unit: uH,
    onSave: (v) => update({ height: heightFromDisplay(v, units) }, "Сохранено") });
  const editWeight = () => ui.sheet({ type: "stepper", title: "Вес", value: weightToDisplay(Number(u.weight) || 70, units), min: weightToDisplay(35, units), max: weightToDisplay(200, units), unit: uW,
    onSave: (v) => update({ weight: weightFromDisplay(v, units) }, "Сохранено") });
  const editTarget = () => ui.sheet({ type: "stepper", title: "Целевой вес", sub: "Для отслеживания прогресса", value: weightToDisplay(Number(u.target_weight) || Number(u.weight) || 70, units), min: weightToDisplay(35, units), max: weightToDisplay(200, units), unit: uW,
    onSave: (v) => update({ target_weight: weightFromDisplay(v, units) }, "Цель по весу сохранена") });
  const editWorkouts = () => ui.sheet({ type: "stepper", title: "Тренировок в неделю", sub: "Из этого считается уровень активности и норма", value: Number(u.workouts_per_week) || 0, min: 0, max: 14, unit: "трен/нед",
    onSave: (v) => update({ workouts_per_week: v }, "Сохранено") });
  const editPace = () => ui.sheet({ type: "options", title: "Темп достижения цели", sub: "Влияет на дефицит/профицит калорий", value: u.pace || "mid", options: PACE_OPTIONS,
    onPick: (v) => update({ pace: v }, "Темп обновлён") });

  const editGoals = () => {
    if (myTrainer) {
      ui.sheet({ type: "info", title: "Норму задаёт тренер", body: "Пока с вами работает тренер, дневную норму КБЖУ настраивает он. Отключите тренера, чтобы менять норму самостоятельно.", actionLabel: "Понятно" });
      return;
    }
    ui.sheet({
      type: "custom",
      render: () => (
        <GoalsEditor
          initial={{ daily_calories: u.daily_calories, daily_protein: u.daily_protein, daily_fat: u.daily_fat, daily_carbs: u.daily_carbs }}
          manual={Boolean(u.goals_set_manually)}
          onSave={async (vals) => { await Profile.setGoals(vals); await reload(); ui.toast("Норма сохранена", "check"); ui.closeSheet(); }}
          onAuto={async () => { await Profile.autoGoals(); await reload(); ui.toast("Включён автоматический расчёт", "check"); ui.closeSheet(); }}
        />
      )
    });
  };

  const editTheme = () => ui.sheet({ type: "options", title: "Тема оформления", value: theme,
    options: [{ value: "light", label: "Светлая", icon: "sun" }, { value: "dark", label: "Тёмная", icon: "moon" }],
    onPick: (v) => update({ theme: v }) });
  const editUnits = () => ui.sheet({ type: "options", title: "Единицы измерения", value: units,
    options: [{ value: "metric", label: "Метрические (кг, см)", icon: "ruler" }, { value: "imperial", label: "Имперские (lb, in)", icon: "ruler" }],
    onPick: (v) => update({ units: v }, "Сохранено") });
  const editAccent = () => ui.sheet({ type: "swatch", title: "Цвет оформления", sub: "Выберите акцент приложения", value: accent, options: ACCENTS,
    onPick: (v) => update({ accent: v }) });
  const editTimezone = () => ui.sheet({ type: "options", title: "Часовой пояс", sub: "Чтобы дни и время приёмов совпадали",
    value: tz, options: TIMEZONES.map((t) => ({ value: t, label: tzLabel(t) })),
    onPick: (v) => update({ timezone: v }, "Часовой пояс обновлён") });

  // PRO/триал - полноценный экран управления подпиской; иначе - экран оплаты.
  const openSubscription = () => {
    if (isPro) navigate("/subscription");
    else navigate("/paywall");
  };

  const onAvatar = async (file) => {
    try { await Profile.avatar(file); await reload(); ui.toast("Фото обновлено", "check"); }
    catch { ui.toast("Не удалось загрузить фото"); }
  };

  const support = (key, title) => () => {
    const link = links?.[key];
    if (link) window.open(link, "_blank");
    else ui.sheet({ type: "info", title, body: "Свяжитесь с поддержкой через Telegram-бота.", actionLabel: "Понятно" });
  };

  // Открытие внешней ссылки корректно из Telegram-webview (как на Главной).
  const openExternal = (url) => {
    if (!url) return;
    const tg = window.Telegram?.WebApp;
    if (tg?.openTelegramLink && /t\.me\//.test(url)) tg.openTelegramLink(url);
    else if (tg?.openLink) tg.openLink(url);
    else window.open(url, "_blank", "noopener");
  };

  const tgUsername = u.username || WebApp.initDataUnsafe?.user?.username || null;
  const tgPhoto = WebApp.initDataUnsafe?.user?.photo_url || null;
  const uploadedAvatar = assetUrl(u.avatar_path);
  const cachedTgAvatar = assetUrl(u.tg_photo_path);
  // Порядок приоритета источников аватара (см. компонент Avatar).
  const avatarSources = [uploadedAvatar, cachedTgAvatar, tgPhoto];
  const subLabel = sub ? `Списание: ${new Date(sub.expires_at).toLocaleDateString("ru-RU")}`
    : trial?.active ? `Пробный период до ${new Date(trial.ends_at).toLocaleDateString("ru-RU")}`
    : myTrainer ? "Доступ от тренера"
    : "Бесплатный доступ";

  // --- переходы между основным экраном и редактированием ---
  const openEdit = () => { setDraftName(u.name || ""); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const doneEdit = async () => {
    const nm = draftName.trim();
    if (nm && nm !== (u.name || "")) {
      try { await update({ name: nm }, "Профиль обновлён"); }
      catch { ui.toast("Не удалось сохранить имя"); }
    }
    setEditing(false);
  };

  // ===================== ЭКРАН РЕДАКТИРОВАНИЯ =====================
  if (editing) {
    return (
      <div className="screen fade-in">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <button className="tap" onClick={cancelEdit} style={{ color: "var(--text-2)", fontWeight: 700, fontSize: 16.5, padding: "8px 4px" }}>Отмена</button>
          <button className="tap" onClick={doneEdit} style={{ color: "var(--primary)", fontWeight: 800, fontSize: 16.5, padding: "8px 4px" }}>Готово</button>
        </div>

        {/* аватар + выбор фото */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 6 }}>
          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) onAvatar(f); }} />
          <Avatar key={avatarSources.join("|") + "-96"} sources={avatarSources} name={u.name} size={96} iconSize={42} />
          <button className="tap" onClick={() => fileRef.current?.click()}
            style={{ color: "var(--primary)", fontWeight: 700, fontSize: 15.5, marginTop: 12 }}>Выбрать фотографию</button>
        </div>

        {/* имя */}
        <input className="sheet-input" value={draftName} placeholder="Ваше имя"
          onChange={(e) => setDraftName(e.target.value)} style={{ marginTop: 18 }} />

        {/* мои данные */}
        <SectionCard title="Мои данные">
          <ListRow icon="user" label="Пол" value={u.gender ? (u.gender === "male" ? "Мужской" : "Женский") : "-"} onClick={editGender} />
          <ListRow icon="calendar" label="Возраст" value={u.age ? u.age + " лет" : "-"} onClick={editAge} />
          <ListRow icon="ruler" label="Рост" value={u.height ? fmtHeight(u.height, units) : "-"} onClick={editHeight} />
          <ListRow icon="weight" label="Вес" value={u.weight ? fmtWeight(u.weight, units) : "-"} onClick={editWeight} />
          <ListRow icon="target" label="Целевой вес" value={u.target_weight ? fmtWeight(u.target_weight, units) : "-"} onClick={editTarget} />
          <ListRow icon="target" label="Активность"
            value={`${Number(u.workouts_per_week) || 0} трен/нед · ${ACTIVITY_LABEL[u.activity] || "-"}`} onClick={editWorkouts} />
          <ListRow icon="flame" label="Темп" value={PACE_LABEL[u.pace || "mid"]} onClick={editPace} />
          <ListRow icon="flame" label="Цель" value={GOAL_LABEL[u.goal] || "-"} last />
        </SectionCard>
        <div style={{ color: "var(--text-2)", fontSize: 12.5, margin: "8px 6px 0", lineHeight: 1.4 }}>
          Цель (похудение/поддержание/набор) определяется автоматически по целевому весу.
        </div>

        {/* норма КБЖУ */}
        <SectionCard title="Норма КБЖУ">
          <ListRow icon="flame" label="Дневная норма"
            value={u.daily_calories ? `${u.daily_calories} ккал${u.goals_set_manually ? " · вручную" : ""}` : "-"}
            onClick={editGoals} last />
        </SectionCard>
        <div style={{ color: "var(--text-2)", fontSize: 13, margin: "10px 6px 0", lineHeight: 1.45 }}>
          Норма пересчитывается автоматически при изменении веса, активности и цели - либо задаётся вручную.
        </div>
      </div>
    );
  }

  // ===================== ОСНОВНОЙ ЭКРАН =====================
  return (
    <div className="screen fade-in">
      <h1 className="h-title" style={{ marginBottom: 16 }}>Профиль</h1>

      {/* user card */}
      <div className="card" style={{ width: "100%", padding: 16, display: "flex", alignItems: "center", gap: 14 }}>
        <Avatar key={avatarSources.join("|") + "-72"} sources={avatarSources} name={u.name} size={72} iconSize={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 21, fontWeight: 800, letterSpacing: "-.3px" }}>{u.name || "Без имени"}</span>
            {isPro && <span className="pill-pro" style={{ fontSize: 11.5, padding: "3px 9px" }}>{subBadge(sub?.type)}</span>}
          </div>
          <div style={{ color: "var(--text-2)", fontSize: 15.5, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tgUsername ? `@${tgUsername}` : "-"}</div>
        </div>
        <button className="tap" onClick={openEdit} style={{ padding: "9px 16px", borderRadius: 12, background: "var(--tint)", color: "var(--primary)", fontWeight: 800, fontSize: 14.5, flex: "0 0 auto" }}>Изм.</button>
      </div>

      {/* subscription */}
      <SectionCard title="Моя подписка">
        <button className={reviewsUrl ? "list-row" : "list-row last"} onClick={openSubscription} style={{ alignItems: "center" }}>
          <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--grad)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 56px", boxShadow: "0 8px 18px -6px var(--primary)" }}>
            <Ic name="crown" size={28} sw={1.7} style={{ color: "#fff" }} />
          </span>
          <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
              <span style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: "-.2px" }}>{isPro ? subName(sub?.type) : "Bytwise Free"}</span>
              {isPro && <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--green-ink)", background: "color-mix(in srgb, var(--green) 16%, transparent)", padding: "2px 8px", borderRadius: 7 }}>{sub ? "Активна" : myTrainer ? "От тренера" : "Пробный"}</span>}
            </div>
            <div style={{ color: "var(--text-2)", fontSize: 13.5, marginTop: 6 }}>{subLabel}</div>
          </div>
          <Ic name="chevronRight" size={19} sw={2.2} style={{ color: "var(--text-3)" }} />
        </button>

        {/* канал с отзывами (ссылка из админки, вкладка «Ссылки») */}
        {reviewsUrl && (
          <button className="list-row last" onClick={() => openExternal(reviewsUrl)} style={{ alignItems: "center" }}>
            <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--tint)", color: "var(--primary)", display: "flex", alignItems: "center", justifyContent: "center", flex: "0 0 56px" }}>
              <Ic name="sparkles" size={26} sw={1.8} />
            </span>
            <div style={{ flex: 1, textAlign: "left", minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 16.5, letterSpacing: "-.2px" }}>Счастливые пользователи Pro</div>
              <div style={{ color: "var(--text-2)", fontSize: 13.5, marginTop: 6 }}>Отзывы о Bytwise</div>
            </div>
            <Ic name="chevronRight" size={19} sw={2.2} style={{ color: "var(--text-3)" }} />
          </button>
        )}
      </SectionCard>

      {/* приглашение друзей - доступно всем, включая тренеров и сотрудников */}
      <SectionCard title="Приглашай друзей">
        <ListRow icon="sparkles" label="Пригласить друга" onClick={() => navigate("/invite")} last />
      </SectionCard>

      {/* тренер: кабинет / стать тренером */}
      {isTrainer ? (
        <SectionCard title="Тренер">
          <ListRow icon="weight" label="Кабинет тренера" onClick={() => navigate("/trainer")} last />
        </SectionCard>
      ) : !myTrainer ? (
        <SectionCard title="Тренерам">
          <ListRow icon="weight" label="Стать тренером" onClick={() => navigate("/become-trainer")} last />
        </SectionCard>
      ) : null}

      {/* ваш тренер (если вы клиент) */}
      {myTrainer && (
        <SectionCard title="Ваш тренер">
          <ListRow icon="user" label={myTrainer.username ? "@" + myTrainer.username : (myTrainer.name || "Тренер")} value="Доступ открыт" />
          <ListRow icon="logout" label="Отключить тренера" danger onClick={disconnectTrainer} last />
        </SectionCard>
      )}

      {/* settings */}
      <SectionCard title="Настройки">
        <ListRow icon="bell" label="Уведомления" control={<Toggle on={notif} onClick={() => update({ notifications_enabled: !notif }, notif ? "Уведомления выключены" : "Уведомления включены")} />} />
        <ListRow icon="palette" label="Тема" value={theme === "dark" ? "Тёмная" : "Светлая"} onClick={editTheme} />
        <ListRow icon="palette" label="Цвет оформления" onClick={editAccent}
          control={<span style={{ width: 26, height: 26, borderRadius: 8, background: "var(--grad)", flex: "0 0 26px", marginRight: 4 }} />} />
        <ListRow icon="utensils" label="Единицы измерения" value={units === "metric" ? "Метрические" : "Имперские"} onClick={editUnits} />
        <ListRow icon="clock" label="Часовой пояс" value={tz.split("/")[1]?.replace("_", " ") || tz} onClick={editTimezone} last />
      </SectionCard>

      {/* other */}
      <SectionCard title="Другое">
        <ListRow icon="help" label="Помощь и поддержка" onClick={support("help", "Помощь и поддержка")} />
        <ListRow icon="shield" label="Политика конфиденциальности" onClick={support("privacy", "Политика конфиденциальности")} />
        <ListRow icon="doc" label="Условия использования" onClick={support("terms", "Условия использования")} last />
      </SectionCard>
    </div>
  );
}
