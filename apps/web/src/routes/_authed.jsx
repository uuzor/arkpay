import { createFileRoute, Outlet } from "@tanstack/react-router";
import { AuthGateError, requireOnboarded } from "@/components/auth/AuthGate";
import DashboardShell from "@/components/arkay/DashboardShell";

export const Route = createFileRoute("/_authed")({
  beforeLoad: requireOnboarded,
  errorComponent: AuthGateError,
  component: AuthedLayout,
});

function AuthedLayout() {
  return (
    <DashboardShell>
      <Outlet />
    </DashboardShell>
  );
}