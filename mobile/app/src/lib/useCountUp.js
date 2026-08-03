import { useEffect, useState } from "react";

// Анимированный счётчик чисел.
export function useCountUp(target, dur = 900, deps = []) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (typeof window === "undefined" || !window.requestAnimationFrame) {
      setVal(target);
      return;
    }
    let raf, start;
    const tick = (ts) => {
      if (!start) start = ts;
      const p = Math.min(1, (ts - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps.length ? deps : [target]);
  return val;
}
