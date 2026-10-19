import { useState } from "react";
import { Link } from "react-router-dom";
import { appUrl } from "../lib/api";
import { useApi } from "../lib/useApi";
import { pct, rub } from "../lib/format";
import { useSession } from "../session.jsx";
import { AnimatedValue, errorText } from "../components/ui.jsx";

const BOT_URL = "https://t.me/TrayEye_bot";

const STEPS = [
  { title: "Камера", text: "Обычная камера над лентой или столом, куда дети сдают подносы. Новое оборудование не нужно." },
  { title: "Поиск подносов", text: "Детектор YOLOE находит подносы на видео прямо на сервере, без платных запросов." },
  { title: "Нейросеть", text: "Только подносы с остатками уходят в нейросеть: она узнаёт блюдо и сколько процентов не доели." },
  { title: "Статистика", text: "Съели, списали, сколько это в рублях - по каждой школе, дню и блюду." },
  { title: "Решения", text: "Прогноз порций на завтра, проблемные школы и рекомендации технологу." }
];

const ROLES = [
  { title: "Комбинат питания", text: "Платит за подписку. Видит все свои школы на одной панели: списания в рублях, прогноз заказа, проблемные школы, отчёты." },
  { title: "Директор школы", text: "Входит по личной ссылке от комбината. Видит свою столовую: что не доедают, посещаемость классов, меню на завтра." },
  { title: "Повар", text: "Пока камеры нет, фотографирует подносы в Telegram-боте @TrayEye_bot. Остальное система посчитает сама." }
];

// «на 1 школу», «на 4 школы», «на 12 школ».
function schoolsWord(n) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "школу";
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return "школы";
  return "школ";
}

// Живые цифры демо-комбината справа от заголовка.
function DemoNumbers({ totals }) {
  const e = totals.economics;
  return (
    <div className="landing-numbers card enter">
      <img className="landing-plate" src={appUrl("/figma/eaten-plate.png")} alt="" />
      <div className="landing-number">
        <span className="metric-label">Списания за {e.days} дней</span>
        <span className="metric-value"><AnimatedValue value={pct(totals.wastePct)} /></span>
        <span className="metric-note">было {pct(totals.baselinePct)} до TrayEye</span>
      </div>
      <div className="landing-number">
        <span className="metric-label">Экономия за {e.days} дней</span>
        <span className="metric-value"><AnimatedValue value={rub(e.savingsRub)} /></span>
        <span className="metric-note">подписка на {totals.schools} {schoolsWord(totals.schools)} - {rub(e.subscriptionRub)} в месяц</span>
      </div>
    </div>
  );
}

// Стартовая страница: что такое TrayEye и вход в демо без личной ссылки (для жюри и QR в презентации).
export default function Landing() {
  const { data } = useApi("/auth/demo");
  const { loginDemo } = useSession();
  const [schoolId, setSchoolId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const schools = data?.schools || [];
  const selected = schoolId || schools[0]?.id || "";

  // После входа корневой маршрут сам уводит в нужный кабинет.
  const enter = async (role) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await loginDemo(role, role === "director" ? Number(selected) : undefined);
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <div className="landing">
      <header className="landing-head">
        <img className="landing-logo" src={appUrl("/brand/trayeye-logo-wide.png")} alt="TrayEye" />
        <a className="landing-tg" href={BOT_URL} target="_blank" rel="noreferrer">Telegram-бот @TrayEye_bot</a>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-text">
          <h1>Камера видит, что дети не доели в школьной столовой</h1>
          <p className="landing-lead">
            TrayEye считает остатки на подносах и показывает комбинату питания списания по каждой школе и блюду
            в рублях. Комбинат готовит столько, сколько съедят, а поварам и детям ничего не нужно делать.
          </p>
          {data && (
            <div className="landing-demo card enter">
              <h3>Посмотреть демо</h3>
              <p className="muted">Тестовые данные комбината «{data.kombinat.name}». Смотреть можно всё, менять нельзя.</p>
              <div className="landing-demo-actions">
                <button className="big" disabled={busy} onClick={() => enter("kombinat")}>Кабинет комбината</button>
                <div className="landing-director">
                  <select aria-label="Школа для кабинета директора" value={selected} onChange={(e) => setSchoolId(e.target.value)}>
                    {schools.map((s) => <option key={s.id} value={s.id} title={s.director_name}>{s.name}</option>)}
                  </select>
                  <button className="big secondary" disabled={busy || !selected} onClick={() => enter("director")}>Кабинет директора</button>
                </div>
              </div>
              {error && <p className="error" role="alert">{error}</p>}
            </div>
          )}
          <Link className="button secondary landing-camera" to="/camera">Посмотреть, как работает камера</Link>
          <p className="muted landing-note">Рабочий вход - по личной ссылке, её выдаёт комбинат питания.</p>
        </div>
        {data?.totals && <DemoNumbers totals={data.totals} />}
      </section>

      <section className="landing-section">
        <h2>Как это работает</h2>
        <ol className="landing-steps">
          {STEPS.map((step, i) => (
            <li key={step.title} className="card enter">
              <span className="landing-step-num">{i + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section">
        <h2>Кому и зачем</h2>
        <div className="grid3">
          {ROLES.map((role) => (
            <div key={role.title} className="card enter landing-role">
              <h3>{role.title}</h3>
              <p>{role.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="landing-foot muted">TrayEye - компьютерное зрение для школьного питания</footer>
    </div>
  );
}
