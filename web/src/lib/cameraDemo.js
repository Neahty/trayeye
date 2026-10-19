// Демо «экран камеры»: записанный прогон модели (web/public/demo/camera.json, его пишет
// camera/tools/make_web_demo.py) проигрывается поверх видео. Здесь только чистые функции:
// что видно на кадре в момент t и какие подносы к этому моменту уже проехали.

// Индекс последнего кадра с временем <= t (кадры отсортированы по времени).
function frameIndex(frames, t) {
  let lo = 0;
  let hi = frames.length - 1;
  if (hi < 0 || t < frames[0].t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const lerp = (a, b, k) => a + (b - a) * k;

// Подносы в момент t: { id, box: [x1, y1, x2, y2] }. Модель смотрит 3 кадра в секунду,
// а видео идёт 15-30: рамку подноса ведём плавно между соседними кадрами модели,
// иначе она прыгает за лентой рывками.
export function traysAt(frames, t) {
  const i = frameIndex(frames, t);
  if (i < 0) return [];
  const cur = frames[i];
  const next = frames[i + 1];
  const k = next ? Math.min(1, (t - cur.t) / Math.max(1e-6, next.t - cur.t)) : 0;
  const ahead = new Map((next?.trays || []).map(([id, ...box]) => [id, box]));
  return cur.trays.map(([id, ...box]) => {
    const to = ahead.get(id);
    return { id, box: to ? box.map((v, j) => lerp(v, to[j], k)) : box };
  });
}

// Посуда и еда на ближайшем кадре модели: [{ kind, box }]. Их не ведём плавно - у них нет номера.
export function detsAt(frames, t) {
  const i = frameIndex(frames, t);
  if (i < 0) return [];
  return frames[i].dets.map(([kind, ...box]) => ({ kind, box }));
}

// Подносы, которые к моменту t уже проехали и разобраны, новые сверху.
export function passedBy(events, t) {
  return events.filter((e) => e.t <= t).reverse();
}

// Счётчики под видео. В ИИ подносы уходят пачками по 8 в одном запросе.
export const AI_BATCH = 8;
export function summary(passed) {
  const empty = passed.filter((e) => e.empty).length;
  const ai = passed.length - empty;
  return { trays: passed.length, empty, ai, requests: Math.ceil(ai / AI_BATCH) };
}

// «Тефтели - осталось 50%» / «Всё съедено». Без ответа ИИ - просто «есть остатки».
export function trayVerdict(event) {
  if (event.empty) return { tone: "ok", title: "Всё съедено", note: "Модель на сервере, без запроса к ИИ" };
  const items = event.ai?.items || [];
  if (!items.length) return { tone: "warn", title: "Есть остатки", note: "Кадр подноса отправлен в ИИ" };
  return {
    tone: "warn",
    title: items.map((it) => `${it.name} - ${it.leftover_pct === 0 ? "съели" : `осталось ${it.leftover_pct}%`}`).join(", "),
    note: "Ответ ИИ по кадру подноса"
  };
}
