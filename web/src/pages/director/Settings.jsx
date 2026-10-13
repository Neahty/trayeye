import { useSession } from "../../session.jsx";
import { Card } from "../../components/ui.jsx";

export default function DirectorSettings() {
  const { cabinet } = useSession();
  return (
    <>
      <h1>Настройки</h1>
      <Card title="Профиль кабинета"><table>
        <tbody>
          <tr><td>Директор</td><td>{cabinet.fullName}</td></tr>
          <tr><td>Школа</td><td>{cabinet.schoolName} (№{cabinet.schoolNumber})</td></tr>
          <tr><td>Комбинат питания</td><td>{cabinet.kombinatName}</td></tr>
        </tbody>
      </table><p className="muted">Вход по личной ссылке. Если она попала к чужим людям — попросите комбинат выдать новую.</p></Card>
    </>
  );
}
