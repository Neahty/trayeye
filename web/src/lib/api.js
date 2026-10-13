// Клиент API. Сессия (JWT после входа по ссылке) хранится в localStorage.

const TOKEN_KEY = "trayeye_session";

export function getSession() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, body) {
  const headers = {};
  const token = getSession();
  if (token) headers.Authorization = `Bearer ${token}`;
  const isForm = body instanceof FormData;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Ссылку отозвали или сессия истекла - выходим.
    if (res.status === 401) setSession(null);
    throw new ApiError(res.status, data.error || "request_failed");
  }
  return data;
}

export const api = {
  get: (path) => request("GET", path),
  post: (path, body) => request("POST", path, body ?? {}),
  put: (path, body) => request("PUT", path, body),
  del: (path) => request("DELETE", path)
};

// Строка запроса без пустых параметров.
export function qs(params) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
}
