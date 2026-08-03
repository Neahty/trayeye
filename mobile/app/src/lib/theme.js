// Палитры акцентов [primary, strong, soft]
export const ACCENTS = [
  ["#7C3AED", "#6D28D9", "#8B5CF6"],
  ["#16A34A", "#15803D", "#22C55E"],
  ["#2563EB", "#1D4ED8", "#3B82F6"],
  ["#E11D6B", "#BE185D", "#F43F8E"],
  ["#EA580C", "#C2410C", "#FB923C"]
];

export const DEFAULT_ACCENT = ACCENTS[0];

// Применяет тему и акцент к :root (CSS-переменные).
export function applyTheme(theme = "light", accent = DEFAULT_ACCENT) {
  const r = document.documentElement;
  const acc = Array.isArray(accent) && accent.length ? accent : DEFAULT_ACCENT;
  const isDark = theme === "dark";
  r.setAttribute("data-theme", isDark ? "dark" : "light");
  r.style.setProperty("--primary", acc[0]);
  r.style.setProperty("--primary-strong", acc[1] || acc[0]);
  r.style.setProperty("--primary-soft", acc[2] || acc[0]);
  r.style.setProperty("--grad", `linear-gradient(135deg, ${acc[2] || acc[0]} 0%, ${acc[0]} 100%)`);
  r.style.setProperty("--tint", `color-mix(in srgb, ${acc[0]} ${isDark ? "22%" : "9%"}, var(--surface))`);
  r.style.setProperty("--tint-2", `color-mix(in srgb, ${acc[0]} ${isDark ? "30%" : "14%"}, var(--surface))`);
}
