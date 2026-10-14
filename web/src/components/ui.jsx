// Кирпичики интерфейса по дизайн-системе из Figma (цвета, иконки, карточки).
import { appUrl } from "../lib/api";

const ERROR_TEXT = {
  ai_not_configured: "Распознавание не настроено: на сервере нет ключа Gemini/OpenAI.",
  ai_failed: "Нейросеть не смогла разобрать фото. Попробуйте другое.",
  no_menu_for_date: "На эту дату нет меню.",
  dish_exists: "Такое блюдо уже есть.",
  supplier_exists: "Такой поставщик уже есть.",
  present_exceeds_students: "Пришло больше детей, чем числится в классе.",
  cannot_revoke_own_link: "Нельзя отозвать ссылку, по которой вы вошли.",
  bad_period: "Проверьте период.",
  too_many_attempts: "Слишком много попыток, подождите."
};

export function errorText(error) {
  return ERROR_TEXT[error?.code] || "Что-то пошло не так. Попробуйте ещё раз.";
}

export function Status({ loading, error }) {
  if (loading) return <p className="muted">Загрузка...</p>;
  if (error) return <p className="error">{errorText(error)}</p>;
  return null;
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
    <section className={`card ${className}`}>
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
    <section className="problem-card">
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
export function Tile({ image, title, value, notes = [], children }) {
  return (
    <section className="card tile">
      <DishImage src={image} />
      <div className="tile-body">
        <div className="tile-title">{title}</div>
        <div className="tile-value">{value}</div>
        {notes.filter(Boolean).map((note) => <div className="tile-note" key={note}>{note}</div>)}
        {children}
      </div>
    </section>
  );
}

// Отправка отчёта: системное «Поделиться», а если его нет - копия в буфер обмена.
export async function shareReport(title, text) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return "Отчёт отправлен.";
    } catch (err) {
      if (err?.name === "AbortError") return null;
    }
  }
  try {
    await navigator.clipboard.writeText(`${title}\n${text}`);
    return "Отчёт скопирован в буфер обмена - вставьте его в письмо или мессенджер.";
  } catch {
    return "Не удалось отправить отчёт: браузер не дал доступ к буферу обмена.";
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

export function MetricCard({ kind, title, value, note, noteIcon = false, blue = false }) {
  return (
    <section className={`card metric-card${blue ? " blue" : ""}`}>
      <img className="metric-art" src={appUrl(METRIC_ART[kind])} alt="" />
      <div>
        <div className="metric-label">{title}</div>
        <div className="metric-value">{value}</div>
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
  link.click();
  URL.revokeObjectURL(url);
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
