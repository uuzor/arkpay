import { LogIn } from "lucide-react";
import { useEffect, useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { skipOnboarding } from "@/components/auth/AuthGate";
import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { apiFetch } from "@/lib/api";
import { safeReturnTo } from "@/lib/authReturnTo";

export function LoginPage() {
  const { login } = useAuth();
  const returnTo = safeReturnTo();
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [demoError, setDemoError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch("/auth/mode")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setDemoEnabled(data?.demoEnabled === true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const exploreDemo = async () => {
    setDemoBusy(true);
    setDemoError(null);
    try {
      const res = await apiFetch("/auth/demo", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || `Demo unavailable (HTTP ${res.status})`);
      }
      // The shared demo workspace skips onboarding: its connections are fixed.
      skipOnboarding(data.workspaceId);
      window.location.assign("/dashboard");
    } catch (e) {
      setDemoError(e?.message ?? "Demo unavailable.");
      setDemoBusy(false);
    }
  };

  return (
    <AuthLayout
      icon={LogIn}
      title="Welcome back"
      subtitle="Sign in to your ArkPay workspace"
    >
      <Button
        type="button"
        variant="outline"
        className="h-12 w-full text-sm font-medium"
        onClick={() => login(returnTo)}
      >
        <GoogleIcon className="mr-2 h-5 w-5" />
        Continue with Google
      </Button>
      {demoEnabled && (
        <div className="mt-3">
          <Button
            type="button"
            variant="secondary"
            className="h-12 w-full text-sm font-medium"
            onClick={exploreDemo}
            disabled={demoBusy}
          >
            {demoBusy ? "Preparing sandbox demo…" : "Explore the live demo"}
          </Button>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            No sign-in needed — a shared sandbox workspace with sample approvals.
          </p>
          {demoError && (
            <p role="alert" className="mt-2 text-center text-xs text-destructive">
              {demoError}
            </p>
          )}
        </div>
      )}
      <p className="mt-6 text-center text-sm text-muted-foreground">
        ArkPay uses Google sign-in so each workspace keeps its own Gmail and
        PayPal connections.
      </p>
    </AuthLayout>
  );
}
