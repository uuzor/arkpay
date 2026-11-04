const AUTH_PAGES = new Set(["/login"]);

/** A same-origin, non-auth destination from ?returnTo=. */
export function safeReturnTo(search) {
  if (typeof window === "undefined") return "/";
  const params = new URLSearchParams(search ?? window.location.search);
  return sanitizeReturnTo(params.get("returnTo"));
}

export function sanitizeReturnTo(raw) {
  if (!raw || typeof window === "undefined") return "/";
  try {
    const url = new URL(raw, window.location.origin);
    if (url.origin !== window.location.origin) return "/";
    for (const p of ["access_token", "clear_access_token", "returnTo"]) {
      url.searchParams.delete(p);
    }
    if (AUTH_PAGES.has(url.pathname.replace(/\/+$/, "") || "/")) return "/";
    const path = url.pathname + url.search;
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
    return path;
  } catch {
    return "/";
  }
}

export function currentPath() {
  if (typeof window === "undefined") return "/";
  return sanitizeReturnTo(window.location.pathname + window.location.search);
}

export function returnToSearch(returnTo) {
  return returnTo && returnTo !== "/" ? { returnTo } : {};
}
