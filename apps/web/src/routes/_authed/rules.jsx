import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into /settings (Nov 2026 consolidation).
export const Route = createFileRoute("/_authed/rules")({
  beforeLoad: () => {
    throw redirect({ to: "/settings", search: { tab: "policy" } });
  },
});
