// Простые кирпичики интерфейса. Оформление появится вместе с дизайном.
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

export function Card({ title, children }) {
  return (
    <section className="card">
      {title && <h3>{title}</h3>}
      {children}
    </section>
  );
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
    <label className="inline">
      {label}{" "}
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
