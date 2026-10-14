// Единые значения анимаций (по ECC motion-foundations): компоненты берут длительности,
// кривые и пружины только отсюда. Анимируем лишь transform и opacity.
// «Уменьшить движение» в системе включает MotionConfig reducedMotion="user" (main.jsx)
// и @media (prefers-reduced-motion) в styles.css.

export const motionTokens = {
  duration: { instant: 0.08, fast: 0.18, normal: 0.35, slow: 0.6, count: 0.9 },
  easing: { smooth: [0.22, 1, 0.36, 1], sharp: [0.4, 0, 0.2, 1] },
  distance: { xs: 4, sm: 8, md: 16, lg: 24 },
  scale: { subtle: 0.98, press: 0.95 }
};

export const springs = {
  snappy: { type: "spring", stiffness: 300, damping: 30 },
  gentle: { type: "spring", stiffness: 160, damping: 22 },
  instant: { type: "spring", stiffness: 600, damping: 35 }
};

// Выпадающие меню шапки: короткий «выезд» вниз с прозрачностью.
export const dropdownMotion = {
  initial: { opacity: 0, y: -motionTokens.distance.sm, scale: motionTokens.scale.subtle },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: -motionTokens.distance.xs, scale: motionTokens.scale.subtle },
  transition: springs.instant
};

// Затемнение под окнами и панелями.
export const fadeMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: motionTokens.duration.fast }
};
