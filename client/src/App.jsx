import { useEffect, useState, useCallback, useRef } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import WebApp from "@twa-dev/sdk";
import { login, Profile, Scan, Membership, MyTrainer } from "./api";
import { AppContext } from "./AppContext";
import { UIProvider, useUI } from "./ui/UIProvider";
import { applyTheme } from "./lib/theme";
import { downscaleImage } from "./lib/image";
import { defaultMeal } from "./ui/meal";
import TabBar from "./components/TabBar";
import Home from "./pages/Home";
import HistoryPage from "./pages/History";
import StatsPage from "./pages/Stats";
import ProfilePage from "./pages/Profile";
import Paywall from "./pages/Paywall";
import ManageSubscription from "./pages/ManageSubscription";
import Onboarding from "./pages/Onboarding";
import SubscribeGate from "./pages/SubscribeGate";
import TrainerPage from "./pages/Trainer";
import BecomeTrainer from "./pages/BecomeTrainer";

function AppShell() {
  const ui = useUI();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [busy, setBusy] = useState(false);
  const [dataVersion, setDataVersion] = useState(0);
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [membership, setMembership] = useState(null);

  const bumpData = useCallback(() => setDataVersion((v) => v + 1), []);

  const loadProfile = useCallback(async () => {
    const p = await Profile.get();
    setProfile(p);
    return p;
  }, []);

  // boot
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        try {
          WebApp.ready();
          WebApp.expand();
          // Закрепляем web-app: вертикальный свайп не сворачивает/закрывает приложение
          WebApp.disableVerticalSwipes?.();
          WebApp.setHeaderColor?.("secondary_bg_color");
        } catch { /* not in telegram */ }
        const u = await login();
        setUser(u);
        // Гейт по подписке на канал. Ошибку проверки трактуем как «подписан»,
        // чтобы сбой сети не блокировал вход.
        try {
          const m = await Membership.status();
          setMembership(m);
        } catch {
          setMembership({ subscribed: true });
        }
        await loadProfile();
        // Возврат после оплаты (реальная ЮKassa) — перечитываем профиль
        try {
          if (new URLSearchParams(window.location.search).get("paid") === "1") {
            await loadProfile();
          }
        } catch { /* ignore */ }
      } catch (e) {
        setError(e?.response?.data?.error || e.message);
      } finally {
        setReady(true);
      }
    })();
  }, [loadProfile]);

  // theme
  useEffect(() => {
    const u = profile?.user;
    if (u) applyTheme(u.theme || "light", u.accent);
  }, [profile]);

  // Привязка к тренеру по ссылке (startapp=tr_<code>): показываем подтверждение один раз за сессию.
  const trainerHandled = useRef(false);
  const doAcceptTrainer = useCallback(async (code, replace) => {
    try {
      const res = await MyTrainer.accept(code, replace);
      await loadProfile();
      ui.toast(res?.trainer?.username ? `Вы подключены к тренеру @${res.trainer.username}` : "Вы подключены к тренеру", "check");
    } catch (e) {
      const d = e?.response?.data;
      const label = (t) => (t?.username ? "@" + t.username : t?.name || "тренер");
      if (e?.response?.status === 409 && d?.conflict) {
        ui.sheet({
          type: "info", title: "Сменить тренера?",
          body: `У вас уже есть тренер ${label(d.current_trainer)}. Сменить на ${label(d.new_trainer)}?`,
          actionLabel: "Сменить", onAction: () => doAcceptTrainer(code, true),
          secondaryLabel: "Оставить текущего"
        });
      } else if (d?.error === "trainer_inactive") ui.toast("Подписка тренера сейчас неактивна");
      else if (d?.error === "cannot_add_self") ui.toast("Это ваша собственная ссылка");
      else if (d?.error === "max_clients_reached") ui.toast("У тренера уже максимум клиентов");
      else ui.toast("Не удалось подключиться к тренеру");
    }
  }, [loadProfile, ui]);

  // Открытие сразу на странице оплаты (startapp=paywall) — так приходят из кнопки
  // «Продлить» в напоминаниях бота. Один раз за сессию.
  const paywallHandled = useRef(false);
  useEffect(() => {
    if (!ready || !profile?.user?.onboarded || paywallHandled.current) return;
    let sp = null;
    try { sp = WebApp.initDataUnsafe?.start_param || new URLSearchParams(window.location.search).get("startapp"); } catch { sp = null; }
    if (sp !== "paywall") return;
    paywallHandled.current = true;
    // Если доступ уже есть (своя подписка или доступ от тренера) — ведём в управление, а не на пейволл.
    const hasAccess = Boolean(profile?.subscription || profile?.trainer);
    navigate(hasAccess ? "/subscription" : "/paywall");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, profile]);

  useEffect(() => {
    if (!ready || !profile?.user?.onboarded || trainerHandled.current) return;
    let sp = null;
    try { sp = WebApp.initDataUnsafe?.start_param || new URLSearchParams(window.location.search).get("startapp"); } catch { sp = null; }
    if (!sp || !sp.startsWith("tr_")) return;
    trainerHandled.current = true;
    ui.sheet({
      type: "info", title: "Приглашение тренера",
      sub: "Вас приглашает тренер в Bytwise.",
      body: "Подключиться? Тренер сможет видеть ваше питание и задавать цели КБЖУ. Доступ к PRO будет открыт, пока активна подписка тренера.",
      actionLabel: "Подключиться", onAction: () => doAcceptTrainer(sp, false),
      secondaryLabel: "Позже"
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, profile]);

  // camera capture (global FAB)
  const handleCapture = useCallback(async (file) => {
    if (busy) return;
    setBusy(true);
    const stop = ui.showScan();
    try {
      const compressed = await downscaleImage(file);
      const res = await Scan.upload(compressed, defaultMeal(profile?.user?.timezone));
      stop();
      bumpData();
      if (res.low_confidence) ui.toast("AI не уверен — проверьте запись", "info");
      else ui.toast("Блюдо добавлено в дневник", "check");
      if (pathname !== "/" && pathname !== "/history") navigate("/");
    } catch (e) {
      stop();
      const d = e?.response?.data;
      if (e?.response?.status === 403 && d?.error === "limit") {
        navigate("/paywall");
      } else if (e?.response?.status === 429) {
        ui.toast("Слишком много запросов, подождите");
      } else {
        ui.toast("Не удалось распознать фото");
      }
    } finally {
      setBusy(false);
    }
  }, [busy, ui, bumpData, navigate, pathname, profile]);

  if (!ready) {
    return (
      <div className="loading">
        <div className="boot-spinner" />
        Загрузка Bytwise…
      </div>
    );
  }
  if (error) {
    return <div className="loading">Ошибка входа: {error}</div>;
  }

  // Гейт: без подписки на канал дальше не пускаем (ни онбординг, ни приложение)
  if (membership && membership.subscribed === false) {
    return (
      <div className="app">
        <SubscribeGate
          channelUrl={membership.channel_url}
          onSubscribed={() => setMembership((m) => ({ ...m, subscribed: true }))}
        />
      </div>
    );
  }

  // Первый вход — онбординг (имя, возраст, пол, рост/вес, тренировки, цель, часовой пояс)
  if (profile && !profile.user?.onboarded) {
    return (
      <AppContext.Provider value={{ user, profile, reload: loadProfile, dataVersion, bumpData }}>
        <div className="app">
          <Onboarding user={profile.user} onDone={loadProfile} />
        </div>
      </AppContext.Provider>
    );
  }

  return (
    <AppContext.Provider value={{ user, profile, reload: loadProfile, dataVersion, bumpData }}>
      <div className="app">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/paywall" element={<Paywall />} />
          <Route path="/subscription" element={<ManageSubscription />} />
          <Route path="/trainer" element={<TrainerPage />} />
          <Route path="/become-trainer" element={<BecomeTrainer />} />
        </Routes>
      </div>
      <TabBar onCapture={handleCapture} busy={busy} />
    </AppContext.Provider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <UIProvider>
        <AppShell />
      </UIProvider>
    </BrowserRouter>
  );
}
