import { Admin, assetUrl } from "../api";
import { useFetch, useLive, Stat, Loader, fmtDate } from "../lib.jsx";

const SOURCE = { photo: "Фото", text: "Описание", manual: "Вручную" };

export default function Scans() {
  const { intervalMs } = useLive();
  const { data, loading } = useFetch(Admin.scans, [], { intervalMs });
  if (loading) return <Loader />;

  return (
    <div>
      <div className="topbar"><h1 className="page-title">Распознавание еды</h1></div>

      <div className="grid cols-4">
        <Stat label="Всего распознаваний" value={data.counts.total} />
        <Stat label="По фото" value={data.counts.photo} />
        <Stat label="По описанию" value={data.counts.text} />
        <Stat label="Доля успешных" value={data.recognition_rate + "%"} />
      </div>

      <div className="grid cols-2" style={{ marginTop: 20 }}>
        <div className="card">
          <div style={{ fontWeight: 800, marginBottom: 12 }}>Что чаще всего едят</div>
          {data.popular.map((p) => (
            <div className="kv" key={p.dish_name}><span>{p.dish_name}</span><span>{p.count}</span></div>
          ))}
          {!data.popular.length && <div className="muted">Пока нет данных</div>}
        </div>
        <div className="card">
          <div style={{ fontWeight: 800, marginBottom: 12 }}>Не удалось распознать</div>
          {data.errors.length ? data.errors.slice(0, 10).map((e) => (
            <div className="kv" key={e.id}><span className="tag">{fmtDate(e.created_at)}</span><span className="tag">{e.details?.message || e.details?.where}</span></div>
          )) : <div className="muted">Ошибок нет</div>}
        </div>
      </div>

      <div className="section-title">Список распознаваний</div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Фото</th><th>Пользователь</th><th>Что распознал ИИ</th><th>Ккал · Б/Ж/У</th><th>Как добавлено</th><th>Дата</th></tr></thead>
          <tbody>
            {data.journal.map((s) => (
              <tr key={s.id}>
                <td data-label="Фото">{s.photo_path
                  ? <img src={assetUrl(s.photo_path)} alt="" style={{ width: 44, height: 44, borderRadius: 8, objectFit: "cover" }} />
                  : <span className="tag">-</span>}</td>
                <td data-label="Пользователь">{s.username || s.telegram_id}</td>
                <td data-label="Что распознал ИИ">{s.dish_name}</td>
                <td data-label="Ккал · Б/Ж/У">{s.calories} ккал · {Math.round(s.protein)}/{Math.round(s.fat)}/{Math.round(s.carbs)}</td>
                <td data-label="Как добавлено"><span className="pill">{SOURCE[s.source] || s.source}</span></td>
                <td data-label="Дата">{fmtDate(s.scanned_at)}</td>
              </tr>
            ))}
            {!data.journal.length && <tr><td colSpan={6} className="muted" style={{ textAlign: "center" }}>Пока пусто</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
