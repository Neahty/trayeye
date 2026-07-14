import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const api = axios.create({ baseURL: `${API_URL}/api`, withCredentials: true });

let token = sessionStorage.getItem("admin_token") || null;

export function setToken(t) {
  token = t;
  if (t) sessionStorage.setItem("admin_token", t);
  else sessionStorage.removeItem("admin_token");
}
export function getToken() { return token; }

api.interceptors.request.use((config) => {
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => {
    // Transitional fallback: old tabs may still rely on Bearer, while the main
    // admin session now lives in the HttpOnly cookie.
    const fresh = r.headers?.["x-admin-token"];
    if (fresh && fresh !== token) setToken(fresh);
    return r;
  },
  (err) => {
    const status = err?.response?.status;
    const url = err?.config?.url || "";
    const isMe = url.includes("/admin/auth/me");
    const skipRedirect = err?.config?.skipAuthRedirect;
    if (status === 401 && !skipRedirect) {
      if (isMe) {
        setToken(null);
        if (!location.pathname.startsWith("/admin/login")) location.href = "/admin/login";
      } else {
        api.get("/admin/auth/me", { skipAuthRedirect: true })
          .catch(() => {
            setToken(null);
            if (!location.pathname.startsWith("/admin/login")) location.href = "/admin/login";
          });
      }
    }
    return Promise.reject(err);
  }
);

export const ASSET_URL = API_URL;

// URL к загруженным фото через /api/uploads (Caddy проксирует только /api/*)
export function assetUrl(p) {
  if (!p) return null;
  return `${API_URL}/api/${String(p).replace(/^\/+/, "")}`;
}

export const Auth = {
  login: (body) => api.post("/admin/auth/login", body).then((r) => r.data),
  me: (config) => api.get("/admin/auth/me", config).then((r) => r.data),
  logout: () => api.post("/admin/auth/logout").then((r) => r.data),
  setup2fa: () => api.post("/admin/auth/setup-2fa").then((r) => r.data),
  verify2fa: (totp) => api.post("/admin/auth/verify-2fa", { totp }).then((r) => r.data),
  changePassword: (body) => api.post("/admin/auth/change-password", body).then((r) => r.data)
};

export const Admin = {
  dashboard: () => api.get("/admin/dashboard").then((r) => r.data),
  users: (params) => api.get("/admin/users", { params }).then((r) => r.data),
  user: (id) => api.get(`/admin/users/${id}`).then((r) => r.data),
  grantSub: (id, body) => api.patch(`/admin/users/${id}/subscription`, body).then((r) => r.data),
  revokeSub: (id) => api.delete(`/admin/users/${id}/subscription`).then((r) => r.data),
  block: (id) => api.patch(`/admin/users/${id}/block`).then((r) => r.data),
  unblock: (id) => api.patch(`/admin/users/${id}/unblock`).then((r) => r.data),
  deleteUser: (id) => api.delete(`/admin/users/${id}`).then((r) => r.data),
  subscriptions: () => api.get("/admin/subscriptions").then((r) => r.data),
  finance: () => api.get("/admin/finance").then((r) => r.data),
  financeYukassa: (params) => api.get("/admin/finance/yukassa", { params }).then((r) => r.data),
  payments: (params) => api.get("/admin/payments", { params }).then((r) => r.data),
  ai: () => api.get("/admin/ai").then((r) => r.data),
  scans: () => api.get("/admin/scans").then((r) => r.data),
  broadcasts: () => api.get("/admin/broadcasts").then((r) => r.data),
  sendBroadcast: (formData) => api.post("/admin/broadcasts", formData).then((r) => r.data),
  funnel: () => api.get("/admin/funnel").then((r) => r.data),
  logs: (params) => api.get("/admin/logs", { params }).then((r) => r.data),
  getSettings: () => api.get("/admin/settings").then((r) => r.data),
  saveSettings: (settings) => api.put("/admin/settings", { settings }).then((r) => r.data),
  runReminders: () => api.post("/admin/reminders/run").then((r) => r.data),
  testReminder: (kind) => api.post("/admin/reminders/test", { kind }).then((r) => r.data),
  testMealReminder: (meal) => api.post("/admin/reminders/meal-test", { meal }).then((r) => r.data)
};

// Раздел «Работники»: сотрудники-пиарщики с реф-ссылками, их рефералы и выплаты.
export const Employees = {
  list: () => api.get("/admin/employees").then((r) => r.data),
  add: (query) => api.post("/admin/employees", { query }).then((r) => r.data),
  remove: (id) => api.delete(`/admin/employees/${id}`).then((r) => r.data),
  detail: (id) => api.get(`/admin/employees/${id}`).then((r) => r.data),
  payout: (id, body) => api.post(`/admin/employees/${id}/payouts`, body).then((r) => r.data),
  cancelPayout: (id, payoutId) => api.post(`/admin/employees/${id}/payouts/${payoutId}/cancel`).then((r) => r.data)
};

// Раздел «Квесты»: квесты с наградами (ссылка + текст в ЛС при получении).
export const Quests = {
  list: () => api.get("/admin/quests").then((r) => r.data),
  meta: () => api.get("/admin/quests/meta").then((r) => r.data),
  create: (body) => api.post("/admin/quests", body).then((r) => r.data),
  update: (id, body) => api.patch(`/admin/quests/${id}`, body).then((r) => r.data),
  remove: (id) => api.delete(`/admin/quests/${id}`).then((r) => r.data)
};

// Раздел «Поддержка»: тикеты создаёт отдельный бот (папка support/), здесь — просмотр и ответы.
export const Support = {
  tickets: (params) => api.get("/admin/support/tickets", { params }).then((r) => r.data),
  ticket: (id) => api.get(`/admin/support/tickets/${id}`).then((r) => r.data),
  reply: (id, text) => api.post(`/admin/support/tickets/${id}/reply`, { text }).then((r) => r.data),
  close: (id) => api.post(`/admin/support/tickets/${id}/close`).then((r) => r.data),
  // Фото из Telegram качаем blob'ом через axios — <img src> не передаст Bearer-токен.
  photoBlob: (fileId) => api.get(`/admin/support/photo/${fileId}`, { responseType: "blob" }).then((r) => r.data)
};
