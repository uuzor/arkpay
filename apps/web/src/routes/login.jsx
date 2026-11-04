import { createFileRoute, redirect } from "@tanstack/react-router";
import { LoginPage } from "@/components/auth/LoginPage";
import { authQuery } from "@/lib/AuthContext";
import { sanitizeReturnTo } from "@/lib/authReturnTo";

/**
 * Signed-in visitors never see the sign-in form again: they go back to
 * where they came from, or straight to the dashboard when there is no
 * return destination.
 */
export const Route = createFileRoute("/login")({
  validateSearch: (search) => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const { user } = await context.queryClient.ensureQueryData(authQuery);
    if (!user) return;
    const dest = search.returnTo ? sanitizeReturnTo(search.returnTo) : "/overview";
    const [pathname, query] = dest.split("?");
    throw redirect({
      to: pathname,
      search: query ? Object.fromEntries(new URLSearchParams(query)) : {},
    });
  },
  component: LoginPage,
});
