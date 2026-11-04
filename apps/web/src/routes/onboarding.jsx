import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Mail,
  Send,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { requireSignedIn, clearOnboardingSkip, isWorkspaceOnboarded, skipOnboarding } from "@/components/auth/AuthGate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { API_BASE, apiJson } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { policyQuery, workspaceQuery } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding")({
  beforeLoad: requireSignedIn,
  component: OnboardingPage,
});

const TIMEZONES = ["UTC", "Africa/Lagos", "Europe/London", "America/New_York", "Asia/Dubai"];
const CURRENCIES = ["USD", "EUR", "GBP", "NGN", "CAD", "AUD"];

function Status({ done, children }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] font-medium",
        done ? "bg-emerald-50 text-emerald-700" : "bg-fog text-graphite",
      )}
    >
      {done ? <CheckCircle2 className="h-3 w-3" /> : null}
      {children}
    </span>
  );
}

function Section({ step, icon: Icon, title, detail, done, children }) {
  return (
    <section className="rounded-xl border border-mist/70 bg-paper p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink text-[12px] font-semibold text-paper">
          {done ? <Check className="h-4 w-4" /> : step}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
            <Status done={done}>{done ? "Connected" : `Step ${step}`}</Status>
          </div>
          <p className="mt-0.5 text-[11.5px] leading-5 text-pewter">{detail}</p>
          <div className="mt-3">{children}</div>
        </div>
        <Icon className="hidden h-4 w-4 text-steel sm:block" strokeWidth={1.8} />
      </div>
    </section>
  );
}

function OnboardingPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [currency, setCurrency] = useState("USD");
  const [paypalClientId, setPaypalClientId] = useState("");
  const [paypalSecret, setPaypalSecret] = useState("");
  const [paypalMode, setPaypalMode] = useState("sandbox");
  const [paypalError, setPaypalError] = useState("");
  const [linkCode, setLinkCode] = useState("");

  const workspace = useQuery({
    ...workspaceQuery,
    refetchInterval: linkCode ? 4000 : false,
  });
  const policy = useQuery(policyQuery);
  const data = workspace.data;
  const complete = isWorkspaceOnboarded(data);

  useEffect(() => {
    if (!data) return;
    setName((current) => current || data.name || "");
    setTimezone((current) => current || data.timezone || "UTC");
    setCurrency((current) => current || data.currency || "USD");
    if (data.telegramLink?.linkCode) setLinkCode(data.telegramLink.linkCode);
    if (complete && data.id) clearOnboardingSkip(data.id);
  }, [data, complete]);

  const saveWorkspace = useMutation({
    mutationFn: () =>
      apiJson("/workspaces/me", {
        method: "PATCH",
        body: { name: name.trim(), timezone, currency },
      }),
    onSuccess: async () => {
      toast.success("Workspace saved");
      await queryClient.invalidateQueries({ queryKey: workspaceQuery.queryKey });
    },
    onError: (e) => toast.error(e.message || "Could not save workspace"),
  });

  const savePaypal = useMutation({
    mutationFn: () =>
      apiJson("/workspaces/me/paypal", {
        method: "PATCH",
        body: {
          clientId: paypalClientId.trim(),
          clientSecret: paypalSecret.trim(),
          mode: paypalMode,
        },
      }),
    onSuccess: async () => {
      setPaypalError("");
      setPaypalSecret("");
      toast.success("PayPal credentials verified and saved");
      await queryClient.invalidateQueries({ queryKey: workspaceQuery.queryKey });
    },
    onError: (e) => {
      setPaypalError(e.message || "PayPal rejected those credentials");
      toast.error(e.message || "PayPal rejected those credentials");
    },
  });

  const mintLinkCode = useMutation({
    mutationFn: () => apiJson("/telegram/link-code", { method: "POST" }),
    onSuccess: async (result) => {
      setLinkCode(result.linkCode);
      await queryClient.invalidateQueries({ queryKey: workspaceQuery.queryKey });
    },
    onError: (e) => toast.error(e.message || "Could not create a Telegram code"),
  });

  const finish = (skip) => {
    if (data?.id) {
      if (skip) skipOnboarding(data.id);
      else clearOnboardingSkip(data.id);
    }
    navigate({ to: "/overview" });
  };

  const copyCode = async () => {
    if (!linkCode) return;
    try {
      await navigator.clipboard.writeText(linkCode);
      toast.success("Link code copied");
    } catch {
      toast.error("Copy failed — select the code manually");
    }
  };

  if (workspace.isLoading) {
    return (
      <div className="grid min-h-screen place-items-center bg-[#fafafb] text-[12px] text-pewter">
        Loading your workspace…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafafb] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-[760px]">
        <header className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-ink text-[13px] font-semibold text-paper">A</span>
            <div>
              <p className="text-[16px] font-semibold tracking-[-0.03em] text-ink">Set up Arkay</p>
              <p className="text-[11.5px] text-pewter">Three connections, then your payment control room.</p>
            </div>
          </div>
          <Button variant="ghost" className="text-[12px] text-graphite" onClick={() => finish(!complete)}>
            {complete ? "Open dashboard" : "I’ll finish later"}
          </Button>
        </header>

        <div className="mb-5 flex items-center gap-2 text-[11px] text-pewter">
          <span className={cn("rounded-md px-2 py-1", data?.gmailConnected ? "bg-emerald-50 text-emerald-700" : "bg-paper")}>
            Gmail {data?.gmailConnected ? "✓" : "—"}
          </span>
          <span className={cn("rounded-md px-2 py-1", data?.paypalConnected ? "bg-emerald-50 text-emerald-700" : "bg-paper")}>
            PayPal {data?.paypalConnected ? "✓" : "—"}
          </span>
          <span className={cn("rounded-md px-2 py-1", data?.telegramLink?.telegramId ? "bg-emerald-50 text-emerald-700" : "bg-paper")}>
            Telegram {data?.telegramLink?.telegramId ? "✓" : "—"}
          </span>
        </div>

        <div className="space-y-3">
          <Section
            step={1}
            icon={UserRound}
            title="Workspace"
            detail="Your name, timezone and default currency. Schedules use the timezone."
            done={Boolean(data?.name)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="workspace-name">Workspace name</Label>
                <Input id="workspace-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={user?.name ?? "My studio"} />
              </div>
              <div className="space-y-1.5">
                <Label>Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => <SelectItem key={tz} value={tz}>{tz}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Currency</Label>
                <Select value={currency} onValueChange={setCurrency}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map((cur) => <SelectItem key={cur} value={cur}>{cur}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button className="mt-3" size="sm" onClick={() => saveWorkspace.mutate()} disabled={saveWorkspace.isPending || !name.trim()}>
              {saveWorkspace.isPending ? "Saving…" : "Save workspace"}
            </Button>
          </Section>

          <Section
            step={2}
            icon={Mail}
            title="Gmail"
            detail="Arkay reads new money requests from this inbox. Read-only access; nothing is sent."
            done={Boolean(data?.gmailConnected)}
          >
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={`${API_BASE}/auth/gmail/connect`}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-3 text-[12px] font-semibold text-paper"
              >
                {data?.gmailConnected ? "Reconnect Gmail" : "Connect Gmail"}
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
              <span className="text-[11.5px] text-pewter">
                {data?.gmailAddress ?? (data?.gmailConnected ? "Connected" : "Not connected")}
              </span>
            </div>
          </Section>

          <Section
            step={3}
            icon={CreditCard}
            title="PayPal"
            detail="PayPal's 'Log in with PayPal' OAuth only shares identity — invoices and payouts need your own REST app credentials from developer.paypal.com. They are verified before being stored per workspace."
            done={Boolean(data?.paypalConnected)}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="paypal-client-id">Client ID</Label>
                <Input id="paypal-client-id" value={paypalClientId} onChange={(e) => setPaypalClientId(e.target.value)} placeholder="Ae…" autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="paypal-secret">Client secret</Label>
                <Input id="paypal-secret" type="password" value={paypalSecret} onChange={(e) => setPaypalSecret(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
              </div>
              <div className="space-y-1.5">
                <Label>Mode</Label>
                <Select value={paypalMode} onValueChange={setPaypalMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sandbox">Sandbox</SelectItem>
                    <SelectItem value="live">Live</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            {paypalError ? <p className="mt-2 text-[11.5px] text-destructive">{paypalError}</p> : null}
            <Button className="mt-3" size="sm" onClick={() => savePaypal.mutate()} disabled={savePaypal.isPending || !paypalClientId.trim() || !paypalSecret.trim()}>
              {savePaypal.isPending ? "Verifying…" : "Verify and save PayPal"}
            </Button>
            {data?.paypalConnected ? (
              <div className="mt-3 rounded-lg border border-mist/60 bg-fog/60 p-2.5 text-[11px] leading-5 text-graphite">
                <p>
                  App{" "}
                  <code className="font-mono text-[10.5px]">
                    {data.paypalAppId ?? "—"}
                  </code>
                  {data.paypalAccountId ? (
                    <>
                      {" "}· account{" "}
                      <code className="font-mono text-[10.5px]">
                        {String(data.paypalAccountId).split("/").pop()?.slice(0, 12)}
                      </code>
                    </>
                  ) : null}
                  {" "}· {data.paypalScopes?.length ?? 0} scopes
                </p>
                {data.paypalMissingScopes?.length ? (
                  <p className="mt-1 text-amber-700">
                    Missing scopes: {data.paypalMissingScopes.join(", ")}. Enable
                    them under the app&apos;s Features in the PayPal dashboard.
                  </p>
                ) : (
                  <p className="mt-1 text-emerald-700">
                    Invoicing, payouts, transaction search and webhooks scopes
                    granted.
                  </p>
                )}
                <p className="mt-1 text-pewter">
                  PayPal does not expose the merchant email to client-credentials
                  tokens — confirm the app owner in the PayPal dashboard.
                </p>
              </div>
            ) : null}
          </Section>

          <Section
            step={4}
            icon={Send}
            title="Telegram"
            detail="Link the bot that sends approval cards. Send the code below to the ArkPay bot."
            done={Boolean(data?.telegramLink?.telegramId)}
          >
            <div className="flex flex-wrap items-center gap-2">
              {linkCode ? (
                <>
                  <code className="rounded-lg border border-mist bg-fog px-3 py-2 font-mono text-[13px] font-semibold tracking-[0.08em] text-ink">
                    {linkCode}
                  </code>
                  <Button variant="outline" size="sm" onClick={copyCode}><Copy className="mr-1 h-3.5 w-3.5" /> Copy</Button>
                  <span className="text-[11.5px] text-pewter">
                    Send <code className="font-mono">/link {linkCode}</code> in the bot
                  </span>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => mintLinkCode.mutate()} disabled={mintLinkCode.isPending}>
                  {mintLinkCode.isPending ? "Creating…" : "Get link code"}
                </Button>
              )}
            </div>
            {linkCode && !data?.telegramLink?.telegramId ? (
              <p className="mt-2 text-[11px] text-pewter">Waiting for the bot… this page refreshes automatically.</p>
            ) : null}
          </Section>

          <Section
            step={5}
            icon={ShieldCheck}
            title="Safety limits"
            detail="These are the effective limits today. They are enforced by the backend Safety Engine."
            done
          >
            {policy.data ? (
              <div className="grid gap-2 text-[11.5px] text-graphite sm:grid-cols-2">
                <p>Per-vendor/day: <strong>{policy.data.config.vendorDailyCap}</strong></p>
                <p>Global/day: <strong>{policy.data.config.globalDailyCap}</strong></p>
                <p>Invoice max: <strong>{policy.data.config.invoiceMaxAmount}</strong></p>
                <p>Auto-approve: <strong>{policy.data.config.autoApproveMaxAmount}</strong></p>
                <p>Currency allow-list: <strong>{policy.data.config.currencyAllowlist.join(", ")}</strong></p>
                <p>Policy: <strong>{policy.data.version}</strong></p>
              </div>
            ) : (
              <p className="text-[11.5px] text-pewter">Loading policy…</p>
            )}
          </Section>
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-pewter">
            {complete ? "Everything is connected." : "You can finish the missing connections later from Settings."}
          </p>
          <Button onClick={() => finish(!complete)} className="gap-2">
            {complete ? "Open dashboard" : "Skip for now"}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
