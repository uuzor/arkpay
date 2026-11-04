import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo } from "react";
import { API_BASE, apiFetch } from "@/lib/api";
import { currentPath } from "@/lib/authReturnTo";

/**
 * The signed-in visitor + personal workspace, resolved once per page load.
 * The Nest API owns the session cookie (`arkpay_session`); this app never
 * sees or stores the token.
 */
export const authQuery = queryOptions({
  queryKey: ["auth", "me"],
  queryFn: async () => {
    const res = await apiFetch("/auth/me");
    if (res.status === 401) return { user: null, workspace: null, error: null };
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `Session lookup failed (HTTP ${res.status})`);
    }
    const data = await res.json();
    return {
      user: data.user ?? null,
      workspace: data.workspace ?? null,
      error: null,
    };
  },
  staleTime: Infinity,
  retry: false,
});

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const queryClient = useQueryClient();
  const { data, error, isPending } = useQuery(authQuery);

  useEffect(() => {
    const onUnauthorized = () => {
      queryClient.setQueryData(authQuery.queryKey, {
        user: null,
        workspace: null,
        error: null,
      });
      const returnTo = `${window.location.pathname}${window.location.search}`;
      if (window.location.pathname !== '/login') {
        window.location.assign(
          `/login${returnTo !== '/' ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`,
        );
      }
    };
    window.addEventListener('arkpay:unauthorized', onUnauthorized);
    return () =>
      window.removeEventListener('arkpay:unauthorized', onUnauthorized);
  }, [queryClient]);

  const value = useMemo(
    () => ({
      user: data?.user ?? null,
      workspace: data?.workspace ?? null,
      isAuthenticated: !!data?.user,
      isLoadingAuth: isPending,
      authError: data?.error ?? (error ? { type: "unknown", message: error.message } : null),
      refresh: () => queryClient.fetchQuery({ ...authQuery, staleTime: 0 }),
      login: (returnTo = currentPath()) => {
        const query = returnTo && returnTo !== "/" ? `?returnTo=${encodeURIComponent(returnTo)}` : "";
        window.location.assign(`${API_BASE}/auth/google${query}`);
      },
      logout: async () => {
        try {
          await apiFetch("/auth/logout", { method: "POST" });
        } finally {
          queryClient.setQueryData(authQuery.queryKey, {
            user: null,
            workspace: null,
            error: null,
          });
          window.location.assign("/login");
        }
      },
    }),
    [data, error, isPending, queryClient],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
