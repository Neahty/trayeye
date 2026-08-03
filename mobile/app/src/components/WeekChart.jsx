import { BarChart, Bar, XAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export default function WeekChart({ data = [], goal }) {
  const chartData = data.map((d) => ({
    day: new Date(d.day).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit" }),
    calories: d.calories
  }));

  if (!chartData.length) return <div className="muted center">Нет данных за период</div>;

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEE" />
        <XAxis dataKey="day" fontSize={11} tickLine={false} axisLine={false} />
        <Tooltip formatter={(v) => [`${v} ккал`, "Калории"]} />
        <Bar dataKey="calories" fill="#7C3AED" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
