import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

const api = axios.create({ baseURL: `${API_URL}/api` });

let token = localStorage.getItem("token") || null;

export function setToken(t) {
  token = t;
  if (t) localStorage.setItem("token", t);
  else localStorage.removeItem("token");
}

api.interceptors.request.use((config) => {
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Пользователя заблокировали — сервер отвечает 403 { error: "blocked" } на ЛЮБОЙ запрос
// (server/src/middleware/auth.js). Сообщаем об этом приложению, чтобы оно показало заглушку
// сразу, а не после перезагрузки: бан может случиться посреди сессии.
let blockedHandler = null;
export function onBlocked(cb) {
  blockedHandler = cb;
}

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err?.response?.status === 403 && err.response.data?.error === "blocked") {
      blockedHandler?.();
    }
    return Promise.reject(err);
  }
);

// Авторизация через Telegram initData (или dev_id для локалки)
export async function login() {
  const tg = window.Telegram?.WebApp;
  const initData = tg?.initData || "";
  const params = new URLSearchParams(window.location.search);
  const devId = params.get("dev_id");

  // Реф-параметр здесь не передаём: сервер его игнорирует, а привязка «кто кого привёл»
  // делается ботом на /start (services/userInvites.js), а не при входе в мини-апп.
  const body = { initData };
  if (!initData && devId) body.dev_id = devId;

  const { data } = await api.post("/auth/telegram", body);
  setToken(data.token);
  return data.user;
}

export const apiClient = api;

// --- Эндпоинты ---
export const Scan = {
  upload: (file, mealType) => {
    const fd = new FormData();
    fd.append("image", file);
    fd.append("meal_type", mealType);
    // Распознавание фото может занять до ~минуты — даём запас по таймауту
    return api.post("/scan", fd, { headers: { "Content-Type": "multipart/form-data" }, timeout: 90000 }).then((r) => r.data);
  },
  text: (body) => api.post("/scan/text", body).then((r) => r.data),
  suggestions: () => api.get("/scan/suggestions").then((r) => r.data),
  update: (id, body) => api.patch(`/scan/${id}`, body).then((r) => r.data),
  remove: (id) => api.delete(`/scan/${id}`).then((r) => r.data)
};

export const History = {
  byDate: (date) => api.get("/history", { params: { date } }).then((r) => r.data)
};

export const Stats = {
  get: (period) => api.get("/stats", { params: { period } }).then((r) => r.data)
};

export const Profile = {
  get: () => api.get("/profile").then((r) => r.data),
  update: (body) => api.patch("/profile", body).then((r) => r.data),
  setGoals: (body) => api.patch("/profile/goals", body).then((r) => r.data),
  autoGoals: () => api.post("/profile/goals/auto").then((r) => r.data),
  avatar: (file) => {
    const fd = new FormData();
    fd.append("avatar", file);
    return api.post("/profile/avatar", fd, { headers: { "Content-Type": "multipart/form-data" } }).then((r) => r.data);
  }
};

export const Achievements = {
  get: () => api.get("/achievements").then((r) => r.data)
};

// Квесты с наградами (заменяют достижения на экране Статистика).
export const Quests = {
  get: () => api.get("/quests").then((r) => r.data),
  claim: (code) => api.post(`/quests/${code}/claim`).then((r) => r.data)
};

export const Membership = {
  status: (force) => api.get("/membership", { params: force ? { force: 1 } : {} }).then((r) => r.data)
};

export const Settings = {
  public: () => api.get("/settings/public").then((r) => r.data)
};

export const Subscription = {
  buy: (type) => api.post("/subscription/buy", { type }).then((r) => r.data),
  status: () => api.get("/subscription/status").then((r) => r.data),
  payments: () => api.get("/subscription/payments").then((r) => r.data),
  cancel: () => api.post("/subscription/cancel").then((r) => r.data)
};

// «Пригласи друга»: личная короткая ссылка юзера и его статистика приглашений.
export const Invite = {
  get: () => api.get("/invite").then((r) => r.data)
};

export const Trainer = {
  invite: () => api.get("/trainer/invite").then((r) => r.data),
  clients: () => api.get("/trainer/clients").then((r) => r.data),
  addClient: (client_code) => api.post("/trainer/clients", { client_code }).then((r) => r.data),
  removeClient: (id) => api.delete(`/trainer/clients/${id}`).then((r) => r.data),
  clientHistory: (id, date) => api.get(`/trainer/clients/${id}/history`, { params: { date } }).then((r) => r.data),
  clientStats: (id, period) => api.get(`/trainer/clients/${id}/stats`, { params: { period } }).then((r) => r.data),
  clientWeight: (id) => api.get(`/trainer/clients/${id}/weight`).then((r) => r.data),
  setGoals: (id, goals) => api.patch(`/trainer/clients/${id}/goals`, goals).then((r) => r.data),
  comment: (scanId, text) => api.post(`/trainer/scans/${scanId}/comment`, { text }).then((r) => r.data)
};

// Связь со СВОИМ тренером (для клиента)
export const MyTrainer = {
  get: () => api.get("/my-trainer").then((r) => r.data),
  accept: (code, replace) => api.post("/my-trainer/accept", { code, replace }).then((r) => r.data),
  disconnect: () => api.delete("/my-trainer").then((r) => r.data)
};

export const Admin = {
  dashboard: () => api.get("/admin/dashboard").then((r) => r.data),
  users: (params) => api.get("/admin/users", { params }).then((r) => r.data),
  grantSub: (id, body) => api.patch(`/admin/users/${id}/subscription`, body).then((r) => r.data),
  block: (id) => api.patch(`/admin/users/${id}/block`).then((r) => r.data),
  unblock: (id) => api.patch(`/admin/users/${id}/unblock`).then((r) => r.data),
  payments: () => api.get("/admin/payments").then((r) => r.data),
  logs: (params) => api.get("/admin/logs", { params }).then((r) => r.data)
};

export const ASSET_URL = API_URL;

// Строит URL к загруженным файлам. Раздача идёт через /api/uploads,
// чтобы корректно работать за reverse-proxy (Caddy проксирует только /api/*).
// photo_path хранится как "uploads/users/<id>/<file>".
export function assetUrl(p) {
  if (!p) return null;
  return `${API_URL}/api/${String(p).replace(/^\/+/, "")}`;
}
