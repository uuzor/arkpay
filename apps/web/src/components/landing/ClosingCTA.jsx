import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

export default function ClosingCTA() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  return (
    <section className="bg-paper">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="rounded-[18px] bg-ink px-8 py-14 text-center shadow-quo sm:px-16">
          <h2 className="mx-auto max-w-[640px] font-dm text-[30px] font-semibold leading-[1.1] tracking-tight text-paper sm:text-[42px]">
            The request is already in your inbox. Let ArkPay answer it.
          </h2>
          <p className="mx-auto mt-4 max-w-[480px] text-[15px] leading-[1.6] text-paper/70">
            Invoiced, chased, collected, and proven safe — with an audit trail you can hand to an accountant.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            {isLoadingAuth ? (
              <span
                aria-hidden="true"
                className="h-[46px] w-[320px] animate-pulse rounded-[10px] bg-paper/10"
              />
            ) : isAuthenticated ? (
              <Link
                to="/overview"
                className="inline-flex items-center gap-2 rounded-[10px] bg-paper px-5 py-3 text-[14px] font-semibold text-ink transition-colors hover:bg-highlighter"
              >
                Go to dashboard <ArrowRight className="h-4 w-4" />
              </Link>
            ) : (
              <>
                <Link
                  to="/overview"
                  className="inline-flex items-center gap-2 rounded-[10px] bg-paper px-5 py-3 text-[14px] font-semibold text-ink transition-colors hover:bg-highlighter"
                >
                  Open the control room <ArrowRight className="h-4 w-4" />
                </Link>
                <Link
                  to="/login"
                  className="rounded-[10px] border border-paper/25 px-5 py-3 text-[14px] font-medium text-paper transition-colors hover:bg-paper/10"
                >
                  Sign in with Google
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
