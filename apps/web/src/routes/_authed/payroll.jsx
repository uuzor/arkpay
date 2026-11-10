import { createFileRoute, redirect } from "@tanstack/react-router";

// Payroll is frozen for the solo-earner story (Nov 2026 redesign): the API,
// agent tools and schedules keep working, but the product no longer surfaces
// a team-payroll page. Direct visits land back on the overview.
export const Route = createFileRoute("/_authed/payroll")({
  beforeLoad: () => {
    throw redirect({ to: "/overview" });
  },
});
