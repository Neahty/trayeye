import { Link } from "react-router-dom";
import { useApi } from "../../lib/useApi";
import { dateTime } from "../../lib/format";
import { useSession } from "../../session.jsx";
import { Card, Status } from "../../components/ui.jsx";
import { TelegramButton } from "../../components/TelegramDialog.jsx";

const SOURCE_TEXT = { camera: "видео с камеры", upload: "фото подноса" };

// Настройки директора: профиль, камера столовой, Telegram и правила прогноза комбината.
export default function DirectorSettings() {
  const { cabinet } = useSession();
  const { data, loading, error, reload } = useApi("/director/settings");
  const camera = data?.camera;

  return (
    <>
      <h1>Настройки</h1>
      <div className="settings-grid">
        <div className="stack">
          <Card title="Профиль кабинета">
            <table className="settings-table"><tbody>
              <tr><td>Директор</td><td>{cabinet.fullName}</td></tr>
              <tr><td>Школа</td><td>{cabinet.schoolName} (№{cabinet.schoolNumber})</td></tr>
              <tr><td>Комбинат питания</td><td>{cabinet.kombinatName}</td></tr>
            </tbody></table>
            <p className="muted">Вход по личной ссылке. Если она попала к чужим людям - попросите комбинат выдать новую.</p>
          </Card>
          <Card title="Камера столовой">
            <Status loading={loading && !data} error={error} />
            {camera && <>
              <table className="settings-table"><tbody>
                <tr>
                  <td>Последний поднос</td>
                  <td>{camera.lastScanAt ? `${dateTime(camera.lastScanAt)}, ${SOURCE_TEXT[camera.lastSource] || camera.lastSource}` : camera.weekTrays ? "живых снимков ещё нет, подносы за неделю - демо-данные" : "камера и повар ещё ничего не присылали"}</td>
                </tr>
                <tr><td>Подносов сегодня</td><td>{camera.todayTrays}</td></tr>
                <tr><td>Подносов за 7 дней</td><td>{camera.weekTrays}</td></tr>
              </tbody></table>
              <p className="muted">
                Видео с камеры над лентой можно загрузить в разделе <Link to="/director/menu">«Меню»</Link>, а повар может
                присылать фото подносов в Telegram-бот.
              </p>
            </>}
          </Card>
        </div>
        <div className="stack">
          <Card title="Telegram">
            <p>Бот @TrayEye_bot присылает вам сводку «Сегодня» и уведомления комбината. Повару можно выдать код, чтобы он присылал фото подносов.</p>
            {data && (
              <p className="muted">Привязано: директор - {data.telegram.director || 0}, повар - {data.telegram.cook || 0}.</p>
            )}
            <TelegramButton role="director" disabled={Boolean(cabinet.demo)} onClosed={reload} />
          </Card>
          {data && (
            <Card title="Правила прогноза">
              <table className="settings-table"><tbody>
                <tr><td>Запас к прогнозу заказа</td><td>{data.kombinat.forecastMarginPct}%</td></tr>
                <tr><td>Блюдо «не едят», если берут меньше</td><td>{data.kombinat.unpopularTakePct}%</td></tr>
              </tbody></table>
              <p className="muted">Правила задаёт комбинат «{data.kombinat.name}» для всех своих школ.</p>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
