import { qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { useDateParam } from "../../lib/hooks";
import { dayLong, isoDate } from "../../lib/format";
import { DateInput, Status, Tile } from "../../components/ui.jsx";

export default function KombinatProducts() {
  const [date, setDate] = useDateParam(isoDate(1));
  const { data, loading, error } = useApi(`/kombinat/products${qs({ date })}`);
  return <>
    <div className="page-heading"><h1>Меню товаров</h1><DateInput value={date} onChange={setDate} /></div>
    <Status loading={loading && !data} error={error} />
    {data && data.products.length === 0 && <p className="muted">На {dayLong(date)} заказов нет.</p>}
    <div className="grid3">
      {data?.products.map((product) => <Tile
        key={product.dish_id}
        image={product.image_url}
        title={product.name}
        value={`${product.portions} шт / ${product.weightKg} кг`}
        focusId={`dish-${product.dish_id}`}
        notes={[`Школы: ${product.school_numbers.join(", ")}`, product.supplier_name || "Поставщик не указан"]}
      />)}
    </div>
  </>;
}
