import { createElement as h } from "react";

const C = (cx, cy, r) => ({ t: "circle", a: { cx, cy, r } });
const L = (x1, y1, x2, y2) => ({ t: "line", a: { x1, y1, x2, y2 } });

const ICONS = {
  gear: [C(12, 12, 3.1), "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"],
  calendar: [{ t: "rect", a: { x: 3, y: 4.5, width: 18, height: 16, rx: 3 } }, L(3, 9, 21, 9), L(8, 2.5, 8, 6), L(16, 2.5, 16, 6)],
  chevronDown: ["M6 9.5 12 15l6-5.5"],
  chevronRight: ["M9.5 6 15 12l-5.5 6"],
  filter: ["M3 5.5h18l-7 8v5l-4 2v-7l-7-8Z"],
  home: ["M4 11 12 4l8 7", "M6 9.5V20h12V9.5"],
  clock: [C(12, 12, 8.6), "M12 7.5V12l3 1.8"],
  camera: ["M4 8.5h3l1.6-2.2h6.8L19 8.5h1a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1Z", C(12, 13, 3.3)],
  bars: [L(6, 20, 6, 13), L(12, 20, 12, 8), L(18, 20, 18, 4)],
  user: [C(12, 8, 3.8), "M5 20c.7-3.6 3.4-5.5 7-5.5s6.3 1.9 7 5.5"],
  bell: ["M18 16V11a6 6 0 1 0-12 0v5l-2 2.5h16L18 16Z", "M9.5 19a2.6 2.6 0 0 0 5 0"],
  palette: ["M12 3a9 9 0 0 0 0 18c1.7 0 2-1.3 1.2-2.3-.8-1-.4-2.3 1-2.3H17a4 4 0 0 0 4-4c0-4.8-4-9.4-9-9.4Z", C(7.5, 11, 1), C(12, 7.5, 1), C(16.5, 11, 1)],
  utensils: ["M4 3v6c0 1.1.9 2 2 2h2a2 2 0 0 0 2-2V3", L(7, 11, 7, 21), "M19 14V3a4.5 4.5 0 0 0-4 4.5v4c0 1.4 1.6 2.5 4 2.5Z", L(19, 14, 19, 21)],
  help: [C(12, 12, 9), "M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.4", L(12, 17.2, 12, 17.25)],
  shield: ["M12 3 5 5.5V11c0 4.3 3 7.7 7 9 4-1.3 7-4.7 7-9V5.5L12 3Z"],
  doc: ["M7 3h7l5 5v13H7V3Z", "M14 3v5h5", L(9.5, 13, 16, 13), L(9.5, 16.5, 16, 16.5)],
  logout: ["M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8", "M16 8l4 4-4 4", L(20, 12, 10, 12)],
  ruler: ["M3 8.5 8.5 3 21 15.5 15.5 21 3 8.5Z", L(7, 9, 8.5, 10.5), L(9.5, 6.5, 11.5, 8.5), L(12, 4, 13.5, 5.5)],
  weight: ["M5 8h14l1.5 12H3.5L5 8Z", "M9 8a3 3 0 0 1 6 0", L(12, 11.5, 12, 16)],
  target: [C(12, 12, 8.6), C(12, 12, 4.8), C(12, 12, 1.2)],
  flame: ["M12 3c3 3.5 5.5 5.8 5.5 9.5A5.5 5.5 0 0 1 6.5 12.5c0-1.4.5-2.6 1.4-3.6.4 1 1.1 1.6 2 1.8C9.4 8 10.3 5.4 12 3Z"],
  info: [C(12, 12, 9), L(12, 11, 12, 16), L(12, 7.8, 12, 7.85)],
  globe: [C(12, 12, 9), L(3, 12, 21, 12), "M12 3a13.5 13.5 0 0 1 0 18", "M12 3a13.5 13.5 0 0 0 0 18"],
  sparkles: ["M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z", "M18 14l.9 2.1L21 17l-2.1.9L18 20l-.9-2.1L15 17l2.1-.9L18 14Z"],
  moon: ["M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"],
  sun: [C(12, 12, 4.3), L(12, 2, 12, 4.6), L(12, 19.4, 12, 22), L(2, 12, 4.6, 12), L(19.4, 12, 22, 12), L(4.9, 4.9, 6.8, 6.8), L(17.2, 17.2, 19.1, 19.1), L(19.1, 4.9, 17.2, 6.8), L(6.8, 17.2, 4.9, 19.1)],
  crown: ["M4 8l3.5 3 4.5-6 4.5 6L20 8l-1.5 10h-13L4 8Z"],
  apple: ["M12 7c-1-2-3.3-2.6-5-1.4C4.6 7.4 4 11 5.4 14.4c1 2.4 2.6 4.6 4.6 4.6.9 0 1.3-.4 2-.4s1.1.4 2 .4c2 0 3.6-2.2 4.6-4.6C20 11 19.4 7.4 17 5.6 15.3 4.4 13 5 12 7Z", "M12 7c.2-1.5 1.2-2.8 2.8-3.2"],
  plus: [L(12, 5, 12, 19), L(5, 12, 19, 12)],
  minus: [L(5, 12, 19, 12)],
  check: ["M5 12.5 10 17.5 19 7"],
  edit: ["M14 4l6 6", "M4 20l1-4L16 5l3 3L8 19l-4 1Z"],
  trash: ["M4 7h16", "M9 7V5h6v2", "M6 7l1 13h10l1-13", L(10, 11, 10, 17), L(14, 11, 14, 17)],
  trophy: ["M7 4h10v4a5 5 0 0 1-10 0V4Z", "M7 6H4v1a3 3 0 0 0 3 3", "M17 6h3v1a3 3 0 0 1-3 3", L(12, 13, 12, 17), "M8.5 20h7", L(9.5, 17, 14.5, 17)]
};

export function Ic({ name, size = 24, sw = 1.9, fill = "none", style, className }) {
  const paths = ICONS[name] || [];
  return h(
    "svg",
    {
      width: size, height: size, viewBox: "0 0 24 24", fill, stroke: "currentColor",
      strokeWidth: sw, strokeLinecap: "round", strokeLinejoin: "round", style, className
    },
    paths.map((p, i) =>
      typeof p === "string" ? h("path", { key: i, d: p }) : h(p.t, { key: i, ...p.a })
    )
  );
}

const MEAL_COLORS = { breakfast: "#FB7C45", lunch: "#F6B81E", dinner: "#F2752E", snack: "#8B5CF6" };

export function MealIcon({ kind, size = 30 }) {
  const col = MEAL_COLORS[kind] || "var(--primary)";
  const svgProps = {
    width: size, height: size, viewBox: "0 0 24 24", fill: "none",
    stroke: col, strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round"
  };
  const ln = (x1, y1, x2, y2, k) => h("line", { key: k, x1, y1, x2, y2 });
  if (kind === "snack") {
    return h("svg", svgProps,
      h("path", { key: "m", d: "M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" }),
      h("path", { key: "s", d: "M17 4.5l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6L14.7 6.8l1.6-.7.7-1.6Z", fill: col, stroke: "none" }));
  }
  if (kind === "dinner") {
    return h("svg", svgProps,
      h("path", { key: "p", d: "M7.5 16a4.5 4.5 0 0 1 9 0" }),
      ln(3, 16, 21, 16, "b"), ln(12, 4, 12, 6, "r1"), ln(5.6, 6.6, 6.8, 7.8, "r2"),
      ln(18.4, 6.6, 17.2, 7.8, "r3"), ln(3.5, 11, 5.5, 11, "r4"), ln(18.5, 11, 20.5, 11, "r5"));
  }
  const rs = kind === "breakfast" ? 3.3 : 4.2;
  return h("svg", svgProps,
    h("circle", { key: "c", cx: 12, cy: 12, r: rs, fill: col, stroke: "none" }),
    [0, 45, 90, 135, 180, 225, 270, 315].map((a, i) => {
      const rad = (a * Math.PI) / 180, r1 = rs + 2.6, r2 = rs + 5;
      return ln(12 + r1 * Math.cos(rad), 12 + r1 * Math.sin(rad), 12 + r2 * Math.cos(rad), 12 + r2 * Math.sin(rad), "ray" + i);
    }));
}

export const MEAL_LABELS = { breakfast: "Завтрак", lunch: "Обед", dinner: "Ужин", snack: "Перекусы" };
