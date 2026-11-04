import { redirect } from "@tanstack/react-router";
import { DefaultCatchBoundary } from "@/components/DefaultCatchBoundary";
import { authQuery } from "@/lib/AuthContext";
import { workspaceQuery } from "@/lib/queries";

const SKIP_PREFIX = "arkpay:onboarding-skipped:";

export function onboardingSkipKey(workspaceId) {
  return `${SKIP_PREFIX}${workspaceId}`;
}

export function isWorkspaceOnboarded(workspace) {
  return !!(
    workspace?.gmailConnected &&
    workspace?.paypalConnected &&
    workspace?.telegramLink?.telegramId
  );
}

export function isOnboardingSkipped(workspaceId) {
  if (typeof window === "undefined" || !workspaceId) return false;
  return window.localStorage.getItem(onboardingSkipKey(workspaceId)) === "1";
}

export function skipOnboarding(workspaceId) {
  if (typeof window !== "undefined" && workspaceId) {
    window.localStorage.setItem(onboardingSkipKey(workspaceId), "1");
  }
}

export function clearOnboardingSkip(workspaceId) {
  if (typeof window !== "undefined" && workspaceId) {
    window.localStorage.removeItem(onboardingSkipKey(workspaceId));
  }
}

/**
 * Login + onboarding gate for the pathless `_authed` layout. Signed-out
 * visitors go to /login; signed-in workspaces missing a connection go to
 * /onboarding unless they explicitly skipped it.
 */
export async function requireSignedIn({ context, location }) {
  const { user } = await context.queryClient.ensureQueryData(authQuery);
  if (!user) {
    throw redirect({
      to: "/login",
      search: { returnTo: location.href },
      reloadDocument: true,
    });
  }
  return { user };
}

export async function requireOnboarded({ context, location }) {
  const { user } = await requireSignedIn({ context, location });
  const workspace = await context.queryClient.ensureQueryData(workspaceQuery);
  if (
    !isWorkspaceOnboarded(workspace) &&
    !isOnboardingSkipped(workspace?.id)
  ) {
    throw redirect({ to: "/onboarding" });
  }
  return { user, workspace };
}

export function AuthGateError({ error }) {
  return <DefaultCatchBoundary error={error} />;
}
