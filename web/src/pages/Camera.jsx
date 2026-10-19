import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { appUrl } from "../lib/api";
import { detsAt, passedBy, summary, traysAt, trayVerdict, verdictShown } from "../lib/cameraDemo";

const DET_COLORS = { plate: "#5bc0ff", bowl: "#3ee0a1", cup: "#c49bff", food: "#ff6b5b" };
// Часы в углу кадра: запись «идёт» в обед.
const LUNCH_START = 12 * 3600 + 40 * 60;

function clock(t) {
  const s = Math.floor(LUNCH_START + t);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
}

// Время видео для отрисовки рамок: requestAnimationFrame, а не timeupdate (тот 4 раза в секунду).
function useVideoTime(videoRef) {
  const [t, setT] = useState(0);
  useEffect(() => {
    let raf;
    const tick = () => {
      const v = videoRef.current;
      if (v) setT((prev) => (Math.abs(v.currentTime - prev) > 1 / 60 ? v.currentTime : prev));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [videoRef]);
  return t;
}

// Уголки видоискателя вокруг подноса: читается как «камера следит», не загораживая еду.
function corners(x1, y1, x2, y2, len) {
  const l = Math.min(len, (x2 - x1) / 3, (y2 - y1) / 3);
  return [
    `M${x1},${y1 + l}V${y1}H${x1 + l}`, `M${x2 - l},${y1}H${x2}V${y1 + l}`,
    `M${x2},${y2 - l}V${y2}H${x2 - l}`, `M${x1 + l},${y2}H${x1}V${y2 - l}`
  ].join("");
}

const TONE_COLORS = { scan: "#ffffff", ok: "#3ddc6e", warn: "#ffb020" };

function Overlay({ demo, t }) {
  const trays = traysAt(demo.frames, t);
  const dets = detsAt(demo.frames, t);
  // Размеры подписей - в пикселях видео: viewBox масштабирует их вместе с кадром.
  const s = demo.width / 960;
  return (
    <svg className="camera-overlay" viewBox={`0 0 ${demo.width} ${demo.height}`} aria-hidden="true">
      {dets.map((d, i) => {
        const [x1, y1, x2, y2] = d.box;
        return <rect key={i} x={x1} y={y1} width={x2 - x1} height={y2 - y1} rx={6 * s} fill="none" stroke={DET_COLORS[d.kind]} strokeWidth={1.4 * s} strokeDasharray={`${5 * s} ${4 * s}`} opacity=".8" />;
      })}
      {trays.map(({ id, box: [x1, y1, x2, y2] }) => {
        const event = verdictShown(demo.events, id, t);
        const tone = event ? (event.empty ? "ok" : "warn") : "scan";
        const label = event ? (event.empty ? `#${id} · всё съедено` : `#${id} · остатки → ИИ`) : `Поднос #${id} · анализ`;
        const pad = 6 * s;
        const w = (label.length * 9.6 + 28) * s;
        return (
          <g key={id} className={`camera-box ${tone}`}>
            <rect x={x1 - pad} y={y1 - pad} width={x2 - x1 + 2 * pad} height={y2 - y1 + 2 * pad} rx={10 * s} fill={tone === "scan" ? "none" : TONE_COLORS[tone]} fillOpacity=".08" stroke={TONE_COLORS[tone]} strokeOpacity=".35" strokeWidth={1.5 * s} />
            <path d={corners(x1 - pad, y1 - pad, x2 + pad, y2 + pad, 28 * s)} fill="none" stroke={TONE_COLORS[tone]} strokeWidth={4 * s} strokeLinecap="round" />
            <rect x={x1 - pad} y={y1 - pad - 38 * s} width={w} height={31 * s} rx={15.5 * s} fill={TONE_COLORS[tone]} />
            <text x={x1 - pad + 14 * s} y={y1 - pad - 17 * s} className="camera-tag" style={{ fontSize: 17 * s }}>{label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function Stat({ value, label }) {
  return (
    <div className="camera-stat">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function FeedItem({ event }) {
  const verdict = trayVerdict(event);
  return (
    <li className={`camera-feed-item enter ${verdict.tone}`}>
      <img src={appUrl(`/demo/${event.crop}`)} alt={`Поднос №${event.id}`} loading="lazy" />
      <div>
        <div className="camera-feed-head">
          <b>Поднос #{event.id}</b>
          <span className={`camera-chip ${verdict.tone}`}>{event.empty ? "без ИИ" : "в ИИ"}</span>
        </div>
        {event.ai?.items?.length ? (
          <ul className="camera-dishes">
            {event.ai.items.map((it) => (
              <li key={it.name}>
                <span>{it.name}</span>
                <span className="camera-meter" aria-hidden="true"><i style={{ transform: `scaleX(${it.leftover_pct / 100})` }} /></span>
                <b>{it.leftover_pct === 0 ? "съели" : `${it.leftover_pct}%`}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="camera-feed-title">{verdict.title}</p>
        )}
        <p className="muted camera-feed-note">{verdict.note}</p>
      </div>
    </li>
  );
}

// Публичная страница для презентации и QR: запись ленты и настоящий прогон модели поверх неё.
export default function Camera() {
  const videoRef = useRef(null);
  const [demo, setDemo] = useState(null);
  const [failed, setFailed] = useState(false);
  const [paused, setPaused] = useState(false);
  const t = useVideoTime(videoRef);

  useEffect(() => {
    let alive = true;
    fetch(appUrl("/demo/camera.json"))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => alive && setDemo(data))
      .catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);

  const passed = useMemo(() => (demo ? passedBy(demo.events, t) : []), [demo, t]);
  const stats = summary(passed);

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  };

  return (
    <div className="landing camera-page">
      <header className="landing-head">
        <Link to="/"><img className="landing-logo" src={appUrl("/brand/trayeye-logo-wide.png")} alt="TrayEye" /></Link>
        <Link className="landing-tg" to="/">Демо кабинетов</Link>
      </header>

      <section className="camera-intro">
        <h1>Камера над лентой с подносами</h1>
        <p className="landing-lead">
          Так TrayEye видит ленту, на которую дети ставят подносы после обеда. Модель на сервере находит каждый
          поднос, пустые записывает сама, а кадры с остатками отправляет нейросети - она называет блюдо и сколько не доели.
        </p>
      </section>

      <div className="camera-grid">
        <div className="card camera-screen">
          <div className="camera-frame">
            <video
              ref={videoRef}
              src={appUrl("/demo/camera.mp4")}
              autoPlay
              muted
              loop
              playsInline
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
            />
            {demo && <Overlay demo={demo} t={t} />}
            <div className="camera-hud">
              <span className={`camera-rec ${paused ? "off" : ""}`}>{paused ? "ПАУЗА" : "REC"}</span>
              <span>КАМЕРА 1 · ЛЕНТА ВОЗВРАТА</span>
              <span className="camera-clock">{clock(t)}</span>
            </div>
          </div>
          <div className="camera-bar">
            <div className="camera-stats">
              <Stat value={stats.trays} label="подносов" />
              <Stat value={stats.empty} label="всё съедено" />
              <Stat value={stats.ai} label="с остатками" />
              <Stat value={stats.requests} label="запросов к ИИ" />
            </div>
            <button type="button" className="secondary" onClick={toggle}>{paused ? "Смотреть" : "Пауза"}</button>
          </div>
          {failed && <p className="error" role="alert">Не удалось загрузить разметку записи. Обновите страницу.</p>}
        </div>

        <aside className="card camera-feed">
          <h3>Разбор подносов</h3>
          {passed.length === 0 && <p className="muted">Первый поднос подъезжает к камере…</p>}
          <ul>
            {passed.map((e) => <FeedItem key={e.id} event={e} />)}
          </ul>
        </aside>
      </div>

      <section className="landing-section">
        <h2>Что происходит на записи</h2>
        <ol className="landing-steps camera-steps">
          <li className="card">
            <span className="landing-step-num">1</span>
            <h3>Подносы - на сервере</h3>
            <p>Модель YOLOE находит подносы и посуду на каждом кадре и ведёт поднос по ленте. Это бесплатно: без внешних сервисов.</p>
          </li>
          <li className="card">
            <span className="landing-step-num">2</span>
            <h3>Пустые - сразу</h3>
            <p>Если тарелки пустые, поднос записывается как «всё съедено» без запроса к нейросети.</p>
          </li>
          <li className="card">
            <span className="landing-step-num">3</span>
            <h3>Остатки - нейросети</h3>
            <p>Кадр подноса с едой уходит в нейросеть пачкой с другими: она узнаёт блюдо из меню и долю остатка.</p>
          </li>
        </ol>
        <p className="muted camera-note">
          Запись - тестовая лента: подносы собраны из фото блюд, настоящая камера в школе снимает так же сверху.
          Рамки и ответы не нарисованы вручную - это записанный прогон модели TrayEye и нейросети Gemini.
        </p>
      </section>

      <footer className="landing-foot muted">TrayEye - компьютерное зрение для школьного питания</footer>
    </div>
  );
}
