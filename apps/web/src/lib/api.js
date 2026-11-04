export const API_BASE = (
  import.meta.env.VITE_API_BASE_URL || '/api'
).replace(/\/+$/, '');

export class ApiError extends Error {
  constructor(
    message,
    status = 0,
    body = null,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Same-origin by default: Vite proxies /api in dev and Caddy strips /api in
 * production. Set VITE_API_BASE_URL only when the API is on another origin.
 */
export async function apiFetch(path, init = {}) {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init.headers || {});
  const body = init.body;
  if (body !== undefined && body !== null && !(body instanceof FormData)) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (typeof body !== 'string') {
      init = { ...init, body: JSON.stringify(body) };
    }
  }
  const res = await fetch(url, {
    credentials: 'include',
    ...init,
    headers,
  });
  if (
    res.status === 401 &&
    typeof window !== 'undefined' &&
    path !== '/auth/me' &&
    path !== '/auth/logout'
  ) {
    window.dispatchEvent(new CustomEvent('arkpay:unauthorized'));
  }
  return res;
}

export async function apiJson(path, init = {}) {
  const res = await apiFetch(path, init);
  const text = await res.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!res.ok) {
    throw new ApiError(
      (body && (body.message || body.error)) || `HTTP ${res.status}`,
      res.status,
      body,
    );
  }
  return body;
}
