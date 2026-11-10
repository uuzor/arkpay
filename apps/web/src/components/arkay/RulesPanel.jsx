import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Coins, ListOrdered, FlaskConical, ShieldAlert, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import Money from "@/components/arkay/Money";
import RiskChip from "@/components/arkay/RiskChip";
import ApprovalDrawer from "@/components/arkay/ApprovalDrawer";
import { riskLabel, riskType, timeAgo } from "@/lib/actionShapes";
import { blockedQuery, policyQuery, policyVersionsQuery } from "@/lib/queries";

const NUMBER_KEYS = [
  { key: "vendorDailyCap", label: "Per-vendor daily cap", hint: "Maximum one contact can receive per day.", money: true },
  { key: "globalDailyCap", label: "Global daily cap", hint: "Total across every action in one day.", money: true },
  { key: "invoiceMaxAmount", label: "Invoice max", hint: "Single invoices above this are blocked.", money: true },
  { key: "batchMaxTotal", label: "Batch total cap", hint: "Payroll and bulk payouts stop above this.", money: true },
  { key: "batchMaxItems", label: "Max batch recipients", hint: "Members per batch.", money: false },
  { key: "duplicateWindowHours", label: "Duplicate window", hint: "Hours back the duplicate scan looks.", money: false, suffix: "h" },
  { key: "dueDateMaxDays", label: "Due-date horizon", hint: "Due dates further out are flagged.", money: false, suffix: "days" },
  { key: "amountAnomalyFactor", label: "Anomaly factor", hint: "Multiples of the usual amount that flag.", money: false, suffix: "×" },
  { key: "autoApproveMaxAmount", label: "Auto-approve under", hint: "0 keeps every action manual. Never applies to new or changed payees.", money: true },
];

const CANDIDATE_CURRENCIES = ["USD", "EUR", "GBP", "NGN", "CAD", "AUD", "JPY", "CHF", "ZAR", "KES", "GHS"];

const GLOSSARY = [
  ["NEW_PAYEE", "First payment to this payee — always needs confirmation."],
  ["PAYEE_CHANGED", "Known payee with a different PayPal email — blocked for payouts."],
  ["EMAIL_CHANGED", "PayPal email differs from the saved contact."],
  ["DUPLICATE", "Same payee + amount + currency inside the window."],
  ["AMOUNT_ANOMALY", "Amount far above this payee's usual."],
  ["INJECTION_SIGNAL", "Instruction-like text in the source — flagged, never followed."],
  ["URGENCY_PRESSURE", "Rush language detected in the source."],
];

const VERDICT_CLS = {
  ALLOW: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  NEEDS_CONFIRMATION: "bg-amber-50 text-amber-800 ring-amber-200",
  BLOCK: "bg-red-50 text-red-700 ring-red-200",
};

function Field({ label, hint, children }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="text-[12.5px] font-medium text-ink">{label}</p>
        {hint ? <p className="text-[11px] leading-4 text-pewter">{hint}</p> : null}
      </div>
      {children}
    </div>
  );
}

export default function RulesPanel() {
  const queryClient = useQueryClient();
  const policy = useQuery(policyQuery);
  const versions = useQuery(policyVersionsQuery);
  const blocked = useQuery(blockedQuery(20));
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [drawerId, setDrawerId] = useState(null);

  const config = policy.data?.config;
  useEffect(() => {
    if (config && !draft) {
      const next = { currencyAllowlist: [...(config.currencyAllowlist ?? [])] };
      for (const { key } of NUMBER_KEYS) next[key] = String(config[key] ?? "");
      setDraft(next);
    }
  }, [config, draft]);

  const dirty = useMemo(() => {
    if (!config || !draft) return false;
    if (JSON.stringify([...draft.currencyAllowlist].sort()) !== JSON.stringify([...(config.currencyAllowlist ?? [])].sort())) return true;
    return NUMBER_KEYS.some(({ key }) => String(config[key] ?? "") !== String(draft[key] ?? "").trim());
  }, [config, draft]);

  const refreshPolicy = () => {
    queryClient.invalidateQueries({ queryKey: ["safety"] });
  };

  const save = async () => {
    if (!config || !draft) return;
    const overrides = {};
    for (const { key } of NUMBER_KEYS) {
      const raw = String(draft[key] ?? "").trim();
      if (raw !== String(config[key] ?? "")) overrides[key] = Number(raw);
    }
    if (JSON.stringify([...draft.currencyAllowlist].sort()) !== JSON.stringify([...(config.currencyAllowlist ?? [])].sort())) {
      overrides.currencyAllowlist = draft.currencyAllowlist;
    }
    if (Object.keys(overrides).length === 0) {
      toast("No changes to save");
      return;
    }
    setSaving(true);
    try {
      const res = await apiJson("/safety/policies", { method: "POST", body: overrides });
      toast(`Policy v${res?.version} saved`, { description: "Applies to future evaluations; old verdicts keep their stamp." });
      setDraft(null);
      refreshPolicy();
    } catch (e) {
      toast("Save failed", { description: e?.message ?? "Could not save the policy." });
    } finally {
      setSaving(false);
    }
  };

  const reset = async () => {
    setResetting(true);
    try {
      await apiJson("/safety/policies", { method: "DELETE" });
      toast("Policy reset to defaults");
      setDraft(null);
      refreshPolicy();
    } catch (e) {
      toast("Reset failed", { description: e?.message ?? "Could not reset the policy." });
    } finally {
      setResetting(false);
    }
  };

  const toggleCurrency = (code) => {
    setDraft((d) => {
      if (!d) return d;
      const has = d.currencyAllowlist.includes(code);
      if (has && d.currencyAllowlist.length === 1) {
        toast("The allow-list needs at least one currency");
        return d;
      }
      return {
        ...d,
        currencyAllowlist: has
          ? d.currencyAllowlist.filter((c) => c !== code)
          : [...d.currencyAllowlist, code],
      };
    });
  };

  const currencies = useMemo(() => {
    const seen = new Set([...CANDIDATE_CURRENCIES, ...(draft?.currencyAllowlist ?? []), ...(config?.currencyAllowlist ?? [])]);
    return [...seen];
  }, [draft, config]);

  if (policy.isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-16 animate-pulse rounded-xl bg-fog" />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-xl bg-fog" />
          <div className="h-72 animate-pulse rounded-xl bg-fog" />
        </div>
      </div>
    );
  }

  if (policy.isError || !policy.data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
        Could not load the safety policy: {policy.error?.message ?? "unknown error"}
      </div>
    );
  }

  const stamp = policy.data.overrideVersion != null ? `base+w${policy.data.overrideVersion}` : "base";
  const blockedRows = blocked.data ?? [];
  const versionRows = versions.data ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12.5px] text-pewter">
            Policy <span className="font-mono text-[11.5px] text-graphite">{stamp}</span>
            {policy.data.overridden ? " · workspace overrides active" : " · global defaults"} · changes apply to new evaluations only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={resetting || !policy.data.overridden}
            className="rounded-xl border border-mist/80 px-3.5 py-2 text-[12.5px] font-medium text-ink transition-colors hover:bg-fog disabled:opacity-40"
          >
            {resetting ? "Resetting…" : "Reset to defaults"}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-mist/70 bg-paper p-4">
          <div className="flex items-center gap-2 border-b border-mist/60 pb-2.5">
            <Coins className="h-4 w-4 text-steel" strokeWidth={1.8} />
            <h2 className="text-[12.5px] font-semibold text-ink">Caps &amp; limits</h2>
          </div>
          <div className="divide-y divide-mist/40">
            {NUMBER_KEYS.map(({ key, label, hint, money, suffix }) => (
              <Field key={key} label={label} hint={hint}>
                <div className="flex items-center gap-1.5">
                  {money ? <span className="text-[12px] text-steel">$</span> : null}
                  <input
                    value={draft?.[key] ?? ""}
                    onChange={(e) => setDraft((d) => (d ? { ...d, [key]: e.target.value } : d))}
                    inputMode="decimal"
                    className="h-8 w-24 rounded-lg border border-mist/80 px-2 text-right text-[12.5px] tabular outline-none focus:border-ink/40"
                  />
                  {suffix ? <span className="text-[11.5px] text-steel">{suffix}</span> : null}
                </div>
              </Field>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-mist/70 bg-paper p-4">
            <div className="flex items-center gap-2 border-b border-mist/60 pb-2.5">
              <ListOrdered className="h-4 w-4 text-steel" strokeWidth={1.8} />
              <h2 className="text-[12.5px] font-semibold text-ink">Currency allow-list</h2>
            </div>
            <p className="mt-2 text-[11.5px] leading-5 text-pewter">
              Anything outside this list is rejected in code before an action is built.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {currencies.map((code) => {
                const on = draft?.currencyAllowlist?.includes(code);
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => toggleCurrency(code)}
                    className={cn(
                      "rounded-md px-2 py-1 font-mono text-[11px] ring-1 ring-inset transition-colors",
                      on ? "bg-ink text-paper ring-ink" : "bg-paper text-steel ring-mist/70 hover:text-ink",
                    )}
                  >
                    {code}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-mist/70 bg-paper p-4">
            <h2 className="text-[12.5px] font-semibold text-ink">Engine rules</h2>
            <p className="mt-1 text-[11.5px] text-pewter">Fixed in code — every evaluation runs them in the same order.</p>
            <ul className="mt-2 space-y-1.5">
              {(policy.data.rules ?? []).map((rule, i) => (
                <li key={i} className="flex items-start gap-2 text-[12px] leading-5 text-graphite">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-steel" />
                  {rule}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-mist/70 bg-paper p-4">
            <h2 className="text-[12.5px] font-semibold text-ink">Version history</h2>
            {versionRows.length === 0 ? (
              <p className="mt-2 text-[12px] text-pewter">No overrides yet — the global defaults are effective.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {versionRows.map((v) => (
                  <li key={v.version} className="flex items-baseline justify-between gap-2 text-[12px]">
                    <span className="font-mono text-ink">w{v.version}</span>
                    <span className="min-w-0 flex-1 truncate text-pewter">
                      {Object.keys(v.config ?? {}).join(", ") || "empty"}
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-steel">{timeAgo(v.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-mist/70 bg-paper p-4">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-red-600" strokeWidth={1.8} />
            <h2 className="text-[12.5px] font-semibold text-ink">Blocked actions</h2>
            <span className="ml-auto rounded-md bg-fog px-1.5 py-0.5 font-mono text-[10.5px] text-graphite">
              {blockedRows.length}
            </span>
          </div>
          {blocked.isLoading ? (
            <div className="mt-3 h-24 animate-pulse rounded-lg bg-fog" />
          ) : blocked.isError ? (
            <p className="mt-3 text-[12px] text-red-700">Could not load blocked actions.</p>
          ) : blockedRows.length === 0 ? (
            <p className="mt-3 text-[12px] text-pewter">Nothing blocked — the engine hasn't stopped anything yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {blockedRows.map((row) => (
                <li key={row.id} className="rounded-lg border border-mist/60 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-[12.5px] font-medium text-ink">{row.payeeName}</p>
                    <Money amount={row.amount} currency={row.currency} className="shrink-0 text-[12.5px] text-ink" />
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-4 text-graphite">{row.safetySummary ?? row.purpose}</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {(row.riskFlags ?? []).map((f) => (
                      <RiskChip key={f} type={riskType(f)} label={riskLabel(f)} />
                    ))}
                    {row.policyVersion ? (
                      <span className="font-mono text-[10px] text-steel">{row.policyVersion}</span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setDrawerId(row.id)}
                      className="ml-auto text-[11.5px] font-medium text-ink hover:underline"
                    >
                      Trace →
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4">
          <EvaluateTester />
          <div className="rounded-xl border border-mist/70 bg-paper p-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-steel" strokeWidth={1.8} />
              <h2 className="text-[12.5px] font-semibold text-ink">Risk-flag glossary</h2>
            </div>
            <ul className="mt-2 space-y-1.5">
              {GLOSSARY.map(([flag, line]) => (
                <li key={flag} className="flex items-start gap-2 text-[11.5px] leading-4">
                  <span className="mt-0.5 shrink-0 font-mono text-[10.5px] text-ink">{flag}</span>
                  <span className="text-graphite">{line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <ApprovalDrawer actionId={drawerId} open={Boolean(drawerId)} onOpenChange={(v) => !v && setDrawerId(null)} />
    </div>
  );
}

function EvaluateTester() {
  const [form, setForm] = useState({ payeeName: "", payeePaypal: "", amount: "", currency: "USD", purpose: "" });
  const [result, setResult] = useState(null);
  const [running, setRunning] = useState(false);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await apiJson("/safety/evaluate", {
        method: "POST",
        body: { type: "PAYOUT_SINGLE", ...form, amount: form.amount.trim() || 0 },
      });
      setResult(res);
    } catch (e) {
      toast("Evaluation failed", { description: e?.message ?? "Could not evaluate." });
    } finally {
      setRunning(false);
    }
  };

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="rounded-xl border border-mist/70 bg-paper p-4">
      <div className="flex items-center gap-2">
        <FlaskConical className="h-4 w-4 text-steel" strokeWidth={1.8} />
        <h2 className="text-[12.5px] font-semibold text-ink">Evaluate tester</h2>
      </div>
      <p className="mt-1 text-[11.5px] text-pewter">Preview a verdict without creating anything or moving money.</p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <input value={form.payeeName} onChange={set("payeeName")} placeholder="Payee name" className="h-8 rounded-lg border border-mist/80 px-2 text-[12px] outline-none placeholder:text-steel focus:border-ink/40" />
        <input value={form.payeePaypal} onChange={set("payeePaypal")} placeholder="PayPal email" inputMode="email" className="h-8 rounded-lg border border-mist/80 px-2 text-[12px] outline-none placeholder:text-steel focus:border-ink/40" />
        <input value={form.amount} onChange={set("amount")} placeholder="Amount" inputMode="decimal" className="h-8 rounded-lg border border-mist/80 px-2 text-[12px] tabular outline-none placeholder:text-steel focus:border-ink/40" />
        <input value={form.currency} onChange={set("currency")} placeholder="USD" maxLength={3} className="h-8 rounded-lg border border-mist/80 px-2 text-[12px] uppercase outline-none placeholder:text-steel focus:border-ink/40" />
        <input value={form.purpose} onChange={set("purpose")} placeholder="Purpose" className="col-span-2 h-8 rounded-lg border border-mist/80 px-2 text-[12px] outline-none placeholder:text-steel focus:border-ink/40" />
      </div>
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="mt-3 rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-50"
      >
        {running ? "Evaluating…" : "Preview verdict"}
      </button>
      {result ? (
        <div className="mt-3 rounded-lg bg-fog/70 p-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset", VERDICT_CLS[result.verdict] ?? "bg-fog text-graphite ring-mist/70")}>
              {result.verdict}
            </span>
            {(result.flags ?? []).map((f) => (
              <RiskChip key={f} type={riskType(f)} label={riskLabel(f)} />
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-5 text-graphite">{result.summary}</p>
          {(result.reasons ?? []).length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {result.reasons.map((r, i) => (
                <li key={i} className="text-[11.5px] leading-4 text-pewter">· {r}</li>
              ))}
            </ul>
          ) : null}
          <p className="mt-1.5 font-mono text-[10px] text-steel">
            {result.policyVersion}
            {result.autoApproveEligible ? " · auto-approve eligible" : ""}
          </p>
        </div>
      ) : null}
    </div>
  );
}
