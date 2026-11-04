import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  CreditCard,
  LogOut,
  Mail,
  Send,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { API_BASE, apiJson } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { workspaceQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authed/settings")({
  head: () => ({ meta: [{ title: "Settings · Arkay" }] }),
  component: SettingsPage,
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

function Card({ icon: Icon, title, detail, status, children }) {
  return (
    <section className="rounded-xl border border-mist/70 bg-paper p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-fog text-graphite">
          <Icon className="h-4 w-4" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[13.5px] font-semibold text-ink">{title}</h2>
            {status}
          </div>
          <p className="mt-0.5 text-[11.5px] leading-5 text-pewter">{detail}</p>
          <div className="mt-3">{children}</div>
        </div>
      </div>
    </section>
  );
}

const inputCls =
  "h-9 w-full rounded-lg border border-mist/80 bg-paper px-2.5 text-[12.5px] text-ink outline-none placeholder:text-steel focus:border-ink/40";
const labelCls = "text-[11px] font-medium uppercase tracking-[0.12em] text-steel";

function SettingsPage() {
  const { user, logout } = useAuth();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [currency, setCurrency] = useState("USD");
  const [paypalClientId, setPaypalClientId] = useState("");
  const [paypalSecret, setPaypalSecret] = useState("");
  const [paypalMode, setPaypalMode] = useState("sandbox");
  const [paypalError, setPaypalError] = useState("");
  const [linkCode, setLinkCode] = useState("");
  const [telegramLinked, setTelegramLinked] = useState(false);

  const workspace = useQuery({
    ...workspaceQuery,
    refetchInterval: linkCode && !telegramLinked ? 4000 : false,
  });
  const data = workspace.data;

  useEffect(() => {
    if (!data) return;
    setName((current) => current || data.name || "");
    setTimezone((current) => current || data.timezone || "UTC");
    setCurrency((current) => current || data.currency || "USD");
    if (data.telegramLink?.linkCode) setLinkCode(data.telegramLink.linkCode);
    if (data.paypalMode) setPaypalMode(data.paypalMode);
    setTelegramLinked(Boolean(data.telegramLink?.telegramId));
  }, [data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: workspaceQuery.queryKey });

  const saveWorkspace = useMutation({
    mutationFn: () =>
      apiJson("/workspaces/me", {
        method: "PATCH",
        body: { name: name.trim(), timezone, currency },
      }),
    onSuccess: async () => {
      toast.success("Workspace saved");
      await refresh();
    },
    onError: (e) => toast.error(e.message || "Could not save workspace"),
  });

  const savePaypal = useMutation({
    mutationFn: () =>
      apiJson("/workspaces/me/paypal", {
        method: "PATCH",
        body: { clientId: paypalClientId.trim(), clientSecret: paypalSecret.trim(), mode: paypalMode },
      }),
    onSuccess: async () => {
      setPaypalError("");
      setPaypalSecret("");
      toast.success("PayPal credentials verified and saved");
      await refresh();
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
      await refresh();
    },
    onError: (e) => toast.error(e.message || "Could not create a Telegram code"),
  });

  const copyCode = async () => {
    if (!linkCode) return;
    try {
      await navigator.clipboard.writeText(linkCode);
      toast.success("Link code copied");
    } catch {
      toast.error("Copy failed — select the code manually");
    }
  };

  const clientIdPreview = data?.paypalClientId
    ? `${String(data.paypalClientId).slice(0, 4)}…${String(data.paypalClientId).slice(-2)}`
    : null;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Settings</h1>
        <p className="mt-1 text-[12.5px] text-pewter">
          {data?.name ? `Workspace ${data.name} — ` : ""}profile, connections, session and data handling.
        </p>
      </header>

      {workspace.isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-fog" />
          ))}
        </div>
      ) : workspace.isError || !data ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load workspace settings: {workspace.error?.message ?? "unknown error"}
        </div>
      ) : (
        <div className="grid max-w-[680px] gap-4">
          <Card
            icon={UserRound}
            title="Profile"
            detail="Your workspace name, timezone and default currency. Schedules run in the timezone."
            status={data.name ? <Status done>Saved</Status> : null}
          >
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="settings-name">Workspace name</label>
                <input
                  id="settings-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="My studio"
                  className={`${inputCls} mt-1`}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="settings-tz">Timezone</label>
                <select id="settings-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={`${inputCls} mt-1`}>
                  {TIMEZONES.map((tz) => (
                    <option key={tz} value={tz}>{tz}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls} htmlFor="settings-ccy">Currency</label>
                <select id="settings-ccy" value={currency} onChange={(e) => setCurrency(e.target.value)} className={`${inputCls} mt-1`}>
                  {CURRENCIES.map((cur) => (
                    <option key={cur} value={cur}>{cur}</option>
                  ))}
                </select>
              </div>
            </div>
            <button
              type="button"
              onClick={() => saveWorkspace.mutate()}
              disabled={saveWorkspace.isPending || !name.trim()}
              className="mt-3 rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-50"
            >
              {saveWorkspace.isPending ? "Saving…" : "Save profile"}
            </button>
          </Card>

          <Card
            icon={Mail}
            title="Gmail"
            detail="Arkay reads new money requests from this inbox. Read-only access; nothing is sent."
            status={data.gmailConnected ? <Status done>Connected</Status> : <Status>Not connected</Status>}
          >
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={`${API_BASE}/auth/gmail/connect`}
                className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper"
              >
                {data.gmailConnected ? "Reconnect Gmail" : "Connect Gmail"}
                <ArrowRight className="h-3.5 w-3.5" />
              </a>
              <span className="text-[12px] text-graphite">
                {data.gmailAddress ?? (data.gmailConnected ? "Connected" : "Not connected")}
              </span>
            </div>
            <p className="mt-2 text-[11px] text-pewter">
              Disconnect isn't available yet — reconnecting replaces the stored grant.
            </p>
          </Card>

          <Card
            icon={CreditCard}
            title="PayPal"
            detail="REST app credentials from developer.paypal.com. Verified live before saving; secrets are never shown back."
            status={data.paypalConnected ? <Status done>{`Connected · ${data.paypalMode ?? "sandbox"}`}</Status> : <Status>Not connected</Status>}
          >
            {clientIdPreview ? (
              <p className="mb-2.5 font-mono text-[11px] text-steel">Client ID {clientIdPreview}</p>
            ) : null}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelCls} htmlFor="settings-pp-id">Client ID</label>
                <input
                  id="settings-pp-id"
                  value={paypalClientId}
                  onChange={(e) => setPaypalClientId(e.target.value)}
                  placeholder="Ae…"
                  autoComplete="off"
                  className={`${inputCls} mt-1`}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="settings-pp-secret">Client secret</label>
                <input
                  id="settings-pp-secret"
                  type="password"
                  value={paypalSecret}
                  onChange={(e) => setPaypalSecret(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  className={`${inputCls} mt-1`}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="settings-pp-mode">Mode</label>
                <select
                  id="settings-pp-mode"
                  value={paypalMode}
                  onChange={(e) => setPaypalMode(e.target.value)}
                  className={`${inputCls} mt-1`}
                >
                  <option value="sandbox">Sandbox</option>
                  <option value="live">Live</option>
                </select>
              </div>
            </div>
            {paypalError ? <p className="mt-2 text-[11.5px] text-red-700">{paypalError}</p> : null}
            <button
              type="button"
              onClick={() => savePaypal.mutate()}
              disabled={savePaypal.isPending || !paypalClientId.trim() || !paypalSecret.trim()}
              className="mt-3 rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-50"
            >
              {savePaypal.isPending ? "Verifying…" : data.paypalConnected ? "Verify and replace" : "Verify and save PayPal"}
            </button>
          </Card>

          <Card
            icon={Send}
            title="Telegram"
            detail="The bot that sends approval cards. Link it once per workspace."
            status={data.telegramLink?.telegramId ? <Status done>Linked</Status> : <Status>Not linked</Status>}
          >
            {data.telegramLink?.telegramId ? (
              <p className="text-[12px] text-graphite">
                Linked as <span className="font-mono text-[11.5px]">{data.telegramLink.telegramId}</span>
                {data.telegramLink.linkedAt
                  ? ` · ${new Date(data.telegramLink.linkedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                  : ""}
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  {linkCode ? (
                    <>
                      <code className="rounded-lg bg-fog px-3 py-2 font-mono text-[13px] font-semibold tracking-[0.08em] text-ink">
                        {linkCode}
                      </code>
                      <button
                        type="button"
                        onClick={copyCode}
                        className="inline-flex items-center gap-1 rounded-xl border border-mist/80 px-2.5 py-2 text-[12px] font-medium text-ink hover:bg-fog"
                      >
                        <Copy className="h-3.5 w-3.5" /> Copy
                      </button>
                      <span className="text-[11.5px] text-pewter">
                        Send <code className="font-mono">/link {linkCode}</code> in the bot
                      </span>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => mintLinkCode.mutate()}
                      disabled={mintLinkCode.isPending}
                      className="rounded-xl border border-mist/80 px-3.5 py-2 text-[12.5px] font-medium text-ink hover:bg-fog disabled:opacity-50"
                    >
                      {mintLinkCode.isPending ? "Creating…" : "Get link code"}
                    </button>
                  )}
                </div>
                {linkCode ? (
                  <p className="mt-2 text-[11px] text-pewter">Waiting for the bot… this page refreshes automatically.</p>
                ) : null}
              </>
            )}
          </Card>

          <Card
            icon={UserRound}
            title="Session"
            detail="Who is signed in to this workspace on this device."
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[12.5px] font-medium text-ink">{user?.name ?? user?.email ?? "Signed in"}</p>
                {user?.email ? <p className="text-[11.5px] text-pewter">{user.email}</p> : null}
              </div>
              <button
                type="button"
                onClick={() => logout()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-mist/80 px-3.5 py-2 text-[12.5px] font-medium text-ink hover:bg-fog"
              >
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </button>
            </div>
          </Card>

          <Card
            icon={ShieldCheck}
            title="Privacy"
            detail="How Arkay reads money requests, what it stores, and how your workspace data is protected."
          >
            <Link
              to="/privacy"
              className="inline-flex items-center gap-1.5 rounded-xl border border-mist/80 px-3.5 py-2 text-[12.5px] font-medium text-ink hover:bg-fog"
            >
              Read the privacy policy
              <ArrowUpRight className="h-3.5 w-3.5 text-steel" />
            </Link>
          </Card>

          <section className="rounded-xl border border-red-200 bg-red-50/50 p-4">
            <div className="flex items-center gap-2">
              <TriangleAlert className="h-4 w-4 text-red-600" strokeWidth={1.8} />
              <h2 className="text-[13.5px] font-semibold text-ink">Danger zone</h2>
            </div>
            <p className="mt-1.5 text-[12px] leading-5 text-graphite">
              Workspace deletion isn't available yet — there is no backend endpoint for it, so this page offers no
              delete button rather than a fake one. Gmail disconnect is also unimplemented; reconnecting replaces the
              stored grant.
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
