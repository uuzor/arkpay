import { createFileRoute, redirect } from "@tanstack/react-router";

// Merged into /inbox (Nov 2026 consolidation).
export const Route = createFileRoute("/_authed/approvals")({
  beforeLoad: () => {
    throw redirect({ to: "/inbox", search: { tab: "approvals" } });
  },
});
