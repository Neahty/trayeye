import { useState } from "react";
import { qs } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { CATEGORY_LABELS, isoDate } from "../../lib/format";
import { Card, DateInput, DishImage, Status } from "../../components/ui.jsx";

export default function KombinatProducts() {
  const [date, setDate] = useState(isoDate(1));
  const { data, loading, error } = useApi(`/kombinat/products${qs({ date })}`);
  return <>
    <div className="page-heading"><h1>Меню товаров</h1><DateInput value={date} onChange={setDate} /></div>
    <p className="page-subtitle">Сводный заказ по блюдам и школам</p>
    <Status loading={loading && !data} error={error} />
    {data && data.products.length === 0 && <p className="muted">На этот день заказов нет.</p>}
    <div className="grid3 product-grid">
      {data?.products.map((product) => <Card key={product.dish_id}>
        <div className="product-card"><DishImage src={product.image_url} /><div>
          <div className="metric-label">{product.name}</div>
          <div className="big">{product.portions} шт / {product.weightKg} кг</div>
          <div className="metric-note">{CATEGORY_LABELS[product.category]}</div>
          <div className="product-meta">Школы: {product.school_numbers.join(", ")}</div>
          <div className="product-meta">{product.supplier_name || "Поставщик не указан"}</div>
        </div></div>
      </Card>)}
    </div>
  </>;
}
