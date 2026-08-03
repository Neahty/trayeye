// Отображение названия подписки по её типу (profile.subscription.type).
// Тренерская подписка показывается как «Тренер» (бейдж) / «Bytwise Тренерская» (карточка),
// остальное (basic, триал, без типа) — PRO.

// Короткий бейдж-плашка.
export function subBadge(type) {
  return type === "trainer" ? "Тренер" : "PRO";
}

// Полное название для карточки/заголовка.
export function subName(type) {
  return type === "trainer" ? "Bytwise Тренерская" : "Bytwise PRO";
}
