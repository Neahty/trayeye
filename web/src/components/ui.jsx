// Кирпичики интерфейса по дизайн-системе из Figma (цвета, иконки, карточки).
import { useEffect, useState } from "react";
import { animate, useReducedMotion } from "motion/react";
import { api, appUrl } from "../lib/api";
import { motionTokens } from "../lib/motion";
import { WASTE_ZONES_HINT, wasteZone } from "../lib/format";

const ERROR_TEXT = {
  ai_not_configured: "Распознавание не настроено: на сервере нет ключа Gemini/OpenAI.",
  ai_failed: "Нейросеть не смогла разобрать фото. Попробуйте другое.",
  camera_unavailable: "Сервис камеры сейчас не запущен на сервере.",
  camera_failed: "Не удалось разобрать видео. Попробуйте другой файл.",
  unsupported_video_type: "Нужно видео: mp4, mov, webm, avi или mkv.",
  file_too_large: "Файл слишком большой.",
  bot_not_configured: "Telegram-бот на сервере ещё не настроен.",
  no_menu_for_date: "На эту дату нет меню.",
  dish_exists: "Такое блюдо уже есть.",
  supplier_exists: "Такой поставщик уже есть.",
  present_exceeds_students: "Пришло больше детей, чем числится в классе.",
  cannot_revoke_own_link: "Нельзя отозвать ссылку, по которой вы вошли.",
  bad_period: "Проверьте период.",
  too_many_attempts: "Слишком много попыток, подождите.",
  school_not_found: "Такой школы нет среди школ комбината.",
  demo_readonly: "Это демо: смотреть можно всё, а менять данные нельзя.",
  demo_disabled: "Демо-вход сейчас выключен.",
  bad_demo_request: "Выберите школу для кабинета директора.",
  bad_settings: "Проверьте значения: название не пустое, проценты в допустимых пределах.",
  not_found: "Уже удалено или не найдено."
};

export function errorText(error) {
  return ERROR_TEXT[error?.code] || "Что-то пошло не так. Попробуйте ещё раз.";
}

// Заглушка на время загрузки: серые мерцающие полосы вместо «Загрузка...».
export function Loading({ rows = 3 }) {
  return (
    <div className="skeleton-stack" role="status" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" />)}
    </div>
  );
}

export function Status({ loading, error }) {
  if (loading) return <Loading />;
  if (error) return <p className="error" role="alert">{errorText(error)}</p>;
  return null;
}

// Сообщение после действия. key по тексту: новое сообщение каждый раз появляется заново.
export function Toast({ children }) {
  if (!children) return null;
  return <p key={String(children)} className="toast" role="status">{children}</p>;
}

// Числа внутри строки («5 400 ₽», «12.5%», «45/50»): только цифры, разряды через пробел.
const NUMBER = /\d(?:[\d\s\u00a0\u202f]*\d)?(?:[.,]\d+)?/g;

function formatLike(sample, value) {
  const decimals = (sample.match(/[.,](\d+)$/)?.[1] || "").length;
  const grouped = /[\s\u00a0\u202f]/.test(sample);
  if (grouped) return Math.round(value).toLocaleString("ru-RU");
  const text = value.toFixed(decimals);
  return sample.includes(",") ? text.replace(".", ",") : text;
}

// Показатель «набегает» от нуля до значения. Экранный диктор читает итоговое значение.
export function AnimatedValue({ value }) {
  const text = String(value ?? "");
  const reduce = useReducedMotion();
  // Сразу с нуля, чтобы итоговое число не мелькнуло до начала анимации.
  const [progress, setProgress] = useState(() => (reduce || !/\d/.test(text) ? 1 : 0));

  useEffect(() => {
    if (reduce || !/\d/.test(text)) { setProgress(1); return undefined; }
    setProgress(0);
    const controls = animate(0, 1, {
      duration: motionTokens.duration.count,
      ease: motionTokens.easing.smooth,
      onUpdate: setProgress
    });
    return () => controls.stop();
  }, [text, reduce]);

  if (progress >= 1) return text;
  const shown = text.replace(NUMBER, (m) => formatLike(m, Number(m.replace(/[\s\u00a0\u202f]/g, "").replace(",", ".")) * progress));
  return <><span aria-hidden="true">{shown}</span><span className="sr-only">{text}</span></>;
}

// Иконки из макета (web/public/figma). Рисуются маской, поэтому берут цвет текста.
const ICONS = {
  home: "imgHome2",
  users: "imgUsers",
  stats: "imgHealthSquare",
  book: "imgBook",
  settings: "imgSettings",
  logout: "imgArrowLeftSquare",
  search: "imgSearch",
  bulb: "imgLightBulb",
  chart: "imgChartDown",
  trend: "imgDashboardChartArrow",
  arrowDownRight: "imgArrowDownRightCircle",
  arrowDown: "imgArrowDownSquare"
};

export function Icon({ name, size = 18, className = "" }) {
  const style = { "--icon": `url("${appUrl(`/figma/${ICONS[name]}.svg`)}")`, "--size": `${size}px` };
  return <span className={`icon ${className}`} style={style} aria-hidden="true" />;
}

// Круг с плюсом у ссылок «Добавить меню», «Пригласить директора».
export function PlusIcon() {
  return (
    <svg className="plus-icon" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 5.5v9M5.5 10h9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

export function Card({ title, icon, tone, className = "", aside, children }) {
  return (
    <section className={`card enter ${className}`}>
      {title && (
        <div className="card-head">
          <h3 className={tone ? `tone-${tone}` : ""}>{icon && <Icon name={icon} size={18} />}{title}</h3>
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

// Красная карточка «Проблемный класс/школа» с кнопкой для технолога.
export function ProblemCard({ title, lines, action }) {
  return (
    <section className="problem-card enter">
      <h3>
        <svg className="problem-icon" viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2" y="2" width="16" height="16" rx="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="10" cy="10" r="3.2" fill="currentColor" />
        </svg>
        {title}
      </h3>
      {lines.filter(Boolean).map((line) => <p key={line}>{line}</p>)}
      {action}
    </section>
  );
}

// Плитка блюда/товара: фото, название, крупное число, подписи мелким шрифтом.
export function Tile({ image, title, value, notes = [], focusId, children }) {
  return (
    <section className="card tile enter" data-focus={focusId}>
      <DishImage src={image} />
      <div className="tile-body">
        <div className="tile-title">{title}</div>
        <div className="tile-value"><AnimatedValue value={value} /></div>
        {notes.filter(Boolean).map((note) => <div className="tile-note" key={note}>{note}</div>)}
        {children}
      </div>
    </section>
  );
}

// «Скопировать отчёт»: текст в буфер обмена, чтобы вставить в письмо или мессенджер.
// Системное «Поделиться» не используем: на ПК оно открывает неудобное окно Windows.
export async function copyReport(title, text) {
  try {
    await navigator.clipboard.writeText(`${title}\n${text}`);
    return "Отчёт скопирован - вставьте его в письмо или мессенджер (Ctrl+V).";
  } catch {
    return "Не удалось скопировать: браузер не дал доступ к буферу обмена.";
  }
}

// «Отправить в комбинат» у директора: отчёт уходит комбинату уведомлением.
export async function sendReportToKombinat(body) {
  try {
    await api.post("/director/reports", body);
    return "Отчёт отправлен в комбинат - он придёт в уведомления.";
  } catch (err) {
    return errorText(err);
  }
}

// Письмо технологу комбината с готовым текстом рекомендаций.
export function mailtoHref(subject, body) {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

const METRIC_ART = {
  waste: "/figma/imgRectangle4273.png",
  savings: "/figma/imgRectangle4274.png",
  kids: "/figma/imgRectangle4275.png",
  eaten: "/figma/eaten-plate.png"
};

// Зона индекса несъедаемости рядом с процентом списаний: норма / риск / высокий риск.
export function ZoneChip({ value }) {
  const zone = wasteZone(value);
  if (!zone) return null;
  return <span className={`zone zone-${zone.key}`} title={WASTE_ZONES_HINT}>{zone.label}</span>;
}

export function MetricCard({ kind, title, value, note, noteIcon = false, blue = false, badge = null }) {
  return (
    <section className={`card metric-card enter${blue ? " blue" : ""}`}>
      <img className="metric-art" src={appUrl(METRIC_ART[kind])} alt="" />
      <div>
        <div className="metric-label">{title}{badge}</div>
        <div className="metric-value"><AnimatedValue value={value} /></div>
        {note && <div className="metric-note">{noteIcon && <Icon name="trend" size={13} />}{note}</div>}
      </div>
    </section>
  );
}

export function exportCsv(filename, rows) {
  const csv = rows.map((row) => row.map((value) => {
    const text = String(value ?? "");
    // Treat API/user-provided labels as plain text when opened in spreadsheet apps.
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(";")).join("\r\n");
  const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  // Firefox качает только ссылку из документа; URL освобождаем после старта загрузки.
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Картинка блюда; если файла нет - серый квадрат, как в макете.
export function DishImage({ src }) {
  return (
    <span className="dish-img">
      {src && <img src={appUrl(src)} alt="" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
    </span>
  );
}

export function DateInput({ value, onChange, label = "Дата" }) {
  return (
    <label className="date-input">
      {label}{" "}
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
