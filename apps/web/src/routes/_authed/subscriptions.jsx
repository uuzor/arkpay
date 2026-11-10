import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into /money (Nov 2026 consolidation).
export const Route = createFileRoute("/_authed/subscriptions")({
  beforeLoad: () => {
    throw redirect({ to: "/money", search: { tab: "retainers" } });
  },
});
