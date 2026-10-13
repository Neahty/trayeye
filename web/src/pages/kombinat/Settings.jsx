import { useSession } from "../../session.jsx";

export default function KombinatSettings() {
  const { cabinet } = useSession();
  return (
    <>
      <h1>Настройки</h1>
      <table>
        <tbody>
          <tr><td>Комбинат</td><td>{cabinet.kombinatName}</td></tr>
        </tbody>
      </table>
      <p className="muted">Ссылки для директоров выдаются и отзываются в разделе «Школы».</p>
    </>
  );
}
