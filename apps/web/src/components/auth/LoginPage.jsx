import { LogIn } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/AuthContext";
import { safeReturnTo } from "@/lib/authReturnTo";

export function LoginPage() {
  const { login } = useAuth();
  const returnTo = safeReturnTo();

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
      <p className="mt-6 text-center text-sm text-muted-foreground">
        ArkPay uses Google sign-in so each workspace keeps its own Gmail and
        PayPal connections.
      </p>
    </AuthLayout>
  );
}
