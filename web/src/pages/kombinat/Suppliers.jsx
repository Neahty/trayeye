import { useState } from "react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/useApi";
import { CATEGORY_LABELS, rub } from "../../lib/format";
import { Card, DishImage, Status, errorText } from "../../components/ui.jsx";

const EMPTY_DISH = { name: "", category: "main", supplier_id: "", portion_grams: "", portion_price: "", image_url: "" };

function AddSupplier({ onAdded }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/kombinat/suppliers", { name });
      setName("");
      setMessage(null);
      onAdded();
    } catch (err) {
      setMessage(errorText(err));
    }
  };
  return (
    <form className="row" onSubmit={submit}>
      <input placeholder="Новый поставщик" value={name} onChange={(e) => setName(e.target.value)} required />
      <button type="submit">Добавить</button>
      {message && <span className="error">{message}</span>}
    </form>
  );
}

function AddDish({ suppliers, categories, onAdded }) {
  const [form, setForm] = useState(EMPTY_DISH);
  const [message, setMessage] = useState(null);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api.post("/kombinat/dishes", {
        name: form.name,
        category: form.category,
        supplier_id: form.supplier_id ? Number(form.supplier_id) : null,
        portion_grams: Number(form.portion_grams),
        portion_price: Number(form.portion_price),
        image_url: form.image_url || undefined
      });
      setForm(EMPTY_DISH);
      setMessage(null);
      onAdded();
    } catch (err) {
      setMessage(errorText(err));
    }
  };

  return (
    <form className="row" onSubmit={submit}>
      <input placeholder="Блюдо" value={form.name} onChange={set("name")} required />
      <select value={form.category} onChange={set("category")}>
        {categories.map((c) => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
      </select>
      <select value={form.supplier_id} onChange={set("supplier_id")}>
        <option value="">Поставщик...</option>
        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <input type="number" min="1" placeholder="Грамм" value={form.portion_grams} onChange={set("portion_grams")} required />
      <input type="number" min="0" step="0.01" placeholder="Цена порции" value={form.portion_price} onChange={set("portion_price")} required />
      <input placeholder="Ссылка на картинку" value={form.image_url} onChange={set("image_url")} />
      <button type="submit">Добавить блюдо</button>
      {message && <span className="error">{message}</span>}
    </form>
  );
}

export default function KombinatSuppliers() {
  const suppliers = useApi("/kombinat/suppliers");
  const dishes = useApi("/kombinat/dishes");
  const reloadAll = () => {
    suppliers.reload();
    dishes.reload();
  };

  return (
    <>
      <h1>Поставщики</h1>
      <Status loading={suppliers.loading && !suppliers.data} error={suppliers.error} />
      <table>
        <thead><tr><th>Поставщик</th><th>Блюд</th></tr></thead>
        <tbody>
          {suppliers.data?.suppliers.map((s) => <tr key={s.id}><td>{s.name}</td><td>{s.dishes}</td></tr>)}
        </tbody>
      </table>
      <AddSupplier onAdded={reloadAll} />

      <h2>Каталог блюд</h2>
      <Status loading={dishes.loading && !dishes.data} error={dishes.error} />
      {dishes.data && (
        <AddDish suppliers={suppliers.data?.suppliers || []} categories={dishes.data.categories} onAdded={reloadAll} />
      )}
      <table>
        <thead><tr><th /><th>Блюдо</th><th>Тип</th><th>Порция</th><th>Цена</th><th>Поставщик</th></tr></thead>
        <tbody>
          {dishes.data?.dishes.map((d) => (
            <tr key={d.id}>
              <td><DishImage src={d.image_url} /></td>
              <td>{d.name}</td>
              <td>{CATEGORY_LABELS[d.category]}</td>
              <td>{d.portion_grams} г</td>
              <td>{rub(d.portion_price)}</td>
              <td>{d.supplier_name || "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
