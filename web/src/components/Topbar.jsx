// Шапка кабинета: быстрый поиск (Ctrl+K), уведомления и меню профиля.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { api, appUrl } from "../lib/api";
import { dropdownMotion, fadeMotion, motionTokens, springs } from "../lib/motion";
import { useDismiss, useModal } from "../lib/hooks";
import { CATEGORY_LABELS } from "../lib/format";
import { useSession } from "../session.jsx";
import { Icon } from "./ui.jsx";
import TelegramDialog, { TelegramGlyph } from "./TelegramDialog.jsx";

const POLL_MS = 60 * 1000;
const RESULTS_PER_GROUP = 6;

// ---------- Поиск ----------

// Лупа линиями: иконка из макета - сплошная заливка и на 17 px сливается в кружок.
function SearchGlyph({ size }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="m15.5 15.5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// Без регистра и «ё», чтобы «Котлеты» находились по «котл», а «Ёжики» по «ежики».
function norm(text) {
  return String(text ?? "").toLowerCase().replaceAll("ё", "е").trim();
}

// Что ищем у каждой роли: разделы + данные кабинета. to - куда ведёт результат.
const SEARCH_SOURCES = {
  director: [
    { path: "/director/classes", group: "Классы", pick: (r) => r.classes.map((c) => ({
      label: `${c.name} класс`, hint: `${c.students_count} учеников`, to: `/director/classes?focus=class-${c.id}` })) },
    { path: "/director/dishes", group: "Блюда", pick: (r) => r.dishes.map((d) => ({
      label: d.name, hint: `${CATEGORY_LABELS[d.category] || ""} · статистика за месяц`, to: `/director/stats?focus=dish-${d.id}` })) }
  ],
  kombinat: [
    { path: "/kombinat/schools", group: "Школы", pick: (r) => r.schools.map((s) => ({
      label: s.name, hint: s.director_name || "директор не назначен", to: `/kombinat/schools/${s.id}`, extra: String(s.number) })) },
    { path: "/kombinat/dishes", group: "Блюда", pick: (r) => r.dishes.map((d) => ({
      label: d.name, hint: d.supplier_name || CATEGORY_LABELS[d.category] || "", to: `/kombinat/suppliers?focus=dish-${d.id}` })) },
    { path: "/kombinat/suppliers", group: "Поставщики", pick: (r) => r.suppliers.map((s) => ({
      label: s.name, hint: `${s.dishes} блюд`, to: `/kombinat/suppliers?focus=supplier-${s.id}` })) }
  ]
};

function SearchDialog({ nav, role, onClose }) {
  const navigate = useNavigate();
  const ref = useRef(null);
  const [query, setQuery] = useState("");
  const [data, setData] = useState(null);
  const [active, setActive] = useState(0);
  useModal(ref, onClose);

  useEffect(() => {
    let cancelled = false;
    Promise.all(SEARCH_SOURCES[role].map((src) => api.get(src.path).then(
      (r) => src.pick(r).map((item) => ({ ...item, group: src.group })),
      () => []
    ))).then((lists) => { if (!cancelled) setData(lists.flat()); });
    return () => { cancelled = true; };
  }, [role]);

  const results = useMemo(() => {
    const q = norm(query);
    const sections = nav.map((n) => ({ label: n.label, hint: "раздел", to: n.to, group: "Разделы" }));
    const all = [...sections, ...(data || [])];
    const found = q ? all.filter((r) => norm(`${r.label} ${r.hint} ${r.extra || ""}`).includes(q)) : sections;
    const perGroup = new Map();
    return found.filter((r) => {
      const n = perGroup.get(r.group) || 0;
      perGroup.set(r.group, n + 1);
      return n < RESULTS_PER_GROUP;
    });
  }, [query, data, nav]);

  useEffect(() => { setActive(0); }, [query]);

  const go = (item) => { onClose(); navigate(item.to); };
  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && results[active]) { e.preventDefault(); go(results[active]); }
  };

  return <>
    <motion.div className="overlay" {...fadeMotion} onClick={onClose} />
    <motion.div
      ref={ref}
      className="search-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="Поиск"
      initial={{ opacity: 0, y: -motionTokens.distance.md, scale: motionTokens.scale.subtle }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -motionTokens.distance.sm, scale: motionTokens.scale.subtle }}
      transition={springs.snappy}
    >
      <div className="search-field">
        <SearchGlyph size={18} />
        <input
          data-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={role === "director" ? "Класс, блюдо или раздел" : "Школа, блюдо, поставщик или раздел"}
          aria-label="Что найти"
          aria-controls="search-results"
          aria-activedescendant={results[active] ? `search-item-${active}` : undefined}
          role="combobox"
          aria-expanded="true"
          autoComplete="off"
        />
        <kbd>Esc</kbd>
      </div>
      <ul className="search-results" id="search-results" role="listbox">
        {results.map((item, i) => (
          <li key={`${item.group}-${item.to}`} role="presentation">
            {(i === 0 || results[i - 1].group !== item.group) && <div className="search-group">{item.group}</div>}
            <button
              type="button"
              id={`search-item-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onClick={() => go(item)}
              tabIndex={-1}
            >
              <span className="search-label">{item.label}</span>
              <span className="search-hint">{item.hint}</span>
            </button>
          </li>
        ))}
        {query && results.length === 0 && <li className="search-empty">{data ? "Ничего не нашлось" : "Ищем..."}</li>}
      </ul>
    </motion.div>
  </>;
}

// ---------- Уведомления ----------

function seenKey(cabinet) {
  return `trayeye_seen_${cabinet.role}_${cabinet.role === "director" ? cabinet.schoolId : cabinet.kombinatId}`;
}

function readSeen(key) {
  try { return localStorage.getItem(key) || ""; } catch { return ""; }
}

function timeAgo(iso) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ч назад`;
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
}

const EVENT_ICON = { menu_added: "book", menu_removed: "book", dish_added: "book", dish_changed: "book", forecast_applied: "chart", tray_scanned: "stats", director_joined: "users", report: "stats" };

function Notifications({ cabinet, open, setOpen }) {
  const navigate = useNavigate();
  const ref = useRef(null);
  const key = seenKey(cabinet);
  const [events, setEvents] = useState([]);
  const [seen, setSeen] = useState(() => readSeen(key));
  // Что было непрочитанным в момент открытия - подсвечено, пока список открыт.
  const [freshIds, setFreshIds] = useState(new Set());
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDismiss(open, close, ref);

  const load = useCallback(() => {
    api.get(`/${cabinet.role}/notifications`).then((r) => setEvents(r.events), () => {});
  }, [cabinet.role]);

  useEffect(() => {
    load();
    const timer = setInterval(load, POLL_MS);
    window.addEventListener("focus", load);
    return () => { clearInterval(timer); window.removeEventListener("focus", load); };
  }, [load]);

  const unread = events.filter((e) => e.created_at > seen);

  const toggle = () => {
    if (open) return close();
    setFreshIds(new Set(unread.map((e) => e.id)));
    if (events[0]) {
      setSeen(events[0].created_at);
      try { localStorage.setItem(key, events[0].created_at); } catch { /* приватный режим */ }
    }
    load();
    setOpen(true);
  };

  // Ведём только внутрь своего кабинета.
  const go = (event) => {
    close();
    if (event.link.startsWith(`/${cabinet.role}`)) navigate(event.link);
  };

  return (
    <div className="topbar-pop" ref={ref}>
      <motion.button
        type="button"
        className="round-action bell-action"
        onClick={toggle}
        aria-label={unread.length ? `Уведомления, новых: ${unread.length}` : "Уведомления"}
        aria-expanded={open}
        aria-haspopup="true"
        title="Уведомления"
        whileTap={{ scale: motionTokens.scale.press }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.6 1.9H4.4L6 16.5Z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
          <path d="M10 20.5a2.2 2.2 0 0 0 4 0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <AnimatePresence>
          {unread.length > 0 && (
            <motion.span
              key="badge"
              className="badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={springs.snappy}
            >{unread.length > 9 ? "9+" : unread.length}</motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div key="notifications" className="dropdown notifications" {...dropdownMotion}>
            <div className="dropdown-head">Уведомления</div>
            {events.length === 0 && <p className="dropdown-empty">Пока ничего нового.</p>}
            <ul>
              {events.map((event, i) => (
                <motion.li
                  key={event.id}
                  initial={{ opacity: 0, y: -motionTokens.distance.xs }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...springs.gentle, delay: Math.min(i, 8) * 0.04 }}
                >
                  <button type="button" className={`notification${freshIds.has(event.id) ? " fresh" : ""}`} onClick={() => go(event)}>
                    <span className="notification-icon"><Icon name={EVENT_ICON[event.kind] || "bulb"} size={16} /></span>
                    <span className="notification-body">
                      <span className="notification-text">{event.text}</span>
                      <span className="notification-time">{timeAgo(event.created_at)}</span>
                    </span>
                  </button>
                </motion.li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- Профиль ----------

function ProfileMenu({ cabinet, open, setOpen, onTelegram }) {
  const navigate = useNavigate();
  const { logout } = useSession();
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), [setOpen]);
  useDismiss(open, close, ref);
  const isDirector = cabinet.role === "director";

  const go = (to) => { close(); navigate(to); };
  const onLogout = () => { close(); logout(); navigate("/"); };

  return (
    <div className="topbar-pop" ref={ref}>
      <motion.button
        type="button"
        className="profile-pill"
        onClick={() => setOpen(!open)}
        aria-label="Профиль"
        aria-expanded={open}
        aria-haspopup="menu"
        whileTap={{ scale: motionTokens.scale.press }}
      >
        <img src={appUrl(cabinet.avatarUrl || "/figma/imgRectangle4271.png")} alt="" />
        <motion.span animate={{ rotate: open ? 180 : 0 }} transition={springs.snappy} className="profile-arrow">
          <Icon name="arrowDown" size={16} />
        </motion.span>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.div key="profile" className="dropdown profile-menu" role="menu" {...dropdownMotion}>
            <div className="profile-card">
              <img src={appUrl(cabinet.avatarUrl || "/figma/imgRectangle4271.png")} alt="" />
              <div>
                <div className="profile-name">{isDirector ? cabinet.fullName : cabinet.kombinatName}</div>
                <div className="profile-role">{isDirector ? `Директор · ${cabinet.schoolName}` : "Комбинат питания"}</div>
              </div>
            </div>
            <button type="button" role="menuitem" className="menu-item tg-menu-item" onClick={() => { close(); onTelegram(); }}>
              <TelegramGlyph size={16} />Привязать Telegram
            </button>
            <button type="button" role="menuitem" className="menu-item" onClick={() => go(`/${cabinet.role}/settings`)}>
              <Icon name="settings" size={16} />Настройки
            </button>
            {!isDirector && (
              <button type="button" role="menuitem" className="menu-item" onClick={() => go("/kombinat/schools")}>
                <Icon name="users" size={16} />Ссылки директоров
              </button>
            )}
            <button type="button" role="menuitem" className="menu-item danger" onClick={onLogout}>
              <Icon name="logout" size={16} />Выйти
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------- Шапка целиком ----------

export default function Topbar({ cabinet, title, nav }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [telegramOpen, setTelegramOpen] = useState(false);
  const openTelegram = useCallback(() => setTelegramOpen(true), []);
  const closeTelegram = useCallback(() => setTelegramOpen(false), []);
  // Открыто одно меню за раз: «bell» | «profile» | null.
  const [menu, setMenu] = useState(null);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const setBell = useCallback((v) => setMenu(v ? "bell" : null), []);
  const setProfile = useCallback((v) => setMenu(v ? "profile" : null), []);
  const openSearch = useCallback(() => { setMenu(null); setSearchOpen(true); }, []);

  // Ctrl+K / Cmd+K и «/» вне полей ввода - открыть поиск.
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
      if ((e.key === "k" || e.key === "K" || e.key === "л" || e.key === "Л") && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openSearch(); }
      else if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openSearch(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openSearch]);

  return (
    <header className="topbar">
      <div className="topbar-title">{title}</div>
      <div className="topbar-actions">
        <motion.button
          type="button"
          className="round-action search-action"
          onClick={openSearch}
          aria-label="Поиск (Ctrl+K)"
          title="Поиск (Ctrl+K)"
          whileTap={{ scale: motionTokens.scale.press }}
        >
          <SearchGlyph size={17} />
        </motion.button>
        <Notifications cabinet={cabinet} open={menu === "bell"} setOpen={setBell} />
        <ProfileMenu cabinet={cabinet} open={menu === "profile"} setOpen={setProfile} onTelegram={openTelegram} />
      </div>
      <AnimatePresence>
        {searchOpen && <SearchDialog key="search" nav={nav} role={cabinet.role} onClose={closeSearch} />}
        {telegramOpen && <TelegramDialog key="telegram" role={cabinet.role} onClose={closeTelegram} />}
      </AnimatePresence>
    </header>
  );
}
