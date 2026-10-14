import { useCallback, useEffect, useRef } from "react";
import { useLocation, useSearchParams } from "react-router-dom";

// Закрыть всплывающее окно по клику мимо него и по Escape.
export function useDismiss(open, onClose, ref) {
  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, ref]);
}

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex='-1'])";

// Модальное окно: фокус внутрь при открытии, Tab не уходит наружу, Escape закрывает,
// страница под окном не прокручивается, после закрытия фокус возвращается на кнопку.
export function useModal(ref, onClose) {
  // Последний onClose без перезапуска эффекта: иначе фокус прыгал бы на первое поле при каждом вводе.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onClose = () => closeRef.current();
    const opener = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const first = ref.current?.querySelector("[data-autofocus]") || ref.current?.querySelector(FOCUSABLE);
    first?.focus();

    const onKey = (e) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
      if (e.key !== "Tab" || !ref.current) return;
      const items = [...ref.current.querySelectorAll(FOCUSABLE)];
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === head) { e.preventDefault(); tail.focus(); }
      else if (!e.shiftKey && document.activeElement === tail) { e.preventDefault(); head.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [ref]);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// Дата страницы в адресе (?date=...): уведомления и поиск открывают нужный день,
// а обновление страницы его не сбрасывает.
export function useDateParam(fallback, key = "date") {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = raw && ISO_DATE.test(raw) ? raw : fallback;
  const setValue = useCallback((next) => {
    setParams((prev) => {
      const copy = new URLSearchParams(prev);
      if (next) copy.set(key, next); else copy.delete(key);
      copy.delete("focus");
      return copy;
    }, { replace: true });
  }, [key, setParams]);
  return [value, setValue];
}

const FOCUS_WAIT_MS = 4000;
const FLASH_MS = 2200;

// ?focus=dish-5: когда строка/плитка с data-focus="dish-5" появится, прокрутить к ней и подсветить.
// Повторный клик по тому же уведомлению - новый location.key, подсветка срабатывает снова.
export function useFocusFlash() {
  const { search, key } = useLocation();
  useEffect(() => {
    const target = new URLSearchParams(search).get("focus");
    if (!target) return undefined;
    let timer;
    const started = Date.now();
    const find = () => {
      const el = document.querySelector(`[data-focus="${CSS.escape(target)}"]`);
      if (el) {
        el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
        el.classList.remove("flash");
        void el.offsetWidth; // перезапуск анимации при повторном переходе
        el.classList.add("flash");
        timer = setTimeout(() => el.classList.remove("flash"), FLASH_MS);
        return;
      }
      if (Date.now() - started < FOCUS_WAIT_MS) timer = setTimeout(find, 120);
    };
    find();
    return () => clearTimeout(timer);
  }, [search, key]);
}
