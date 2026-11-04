import { Link } from "@tanstack/react-router";
import { ShieldCheck, ArrowUpRight } from "lucide-react";
import Money from "@/components/arkay/Money";
import RiskChip from "@/components/arkay/RiskChip";
import { riskLabel, riskType } from "@/lib/actionShapes";

/**
 * Inline draft card. Accepts the demo shape ({id, sender, checks, ...}) and
 * the real AgentDraftCard ({actionId, payeeName, policyVerdict, ...}).
 */
export default function DraftCard({ draft }) {
  const real = draft && "actionId" in draft;
  const id = real ? draft.actionId : draft.id;
  const blocked = real ? draft.blocked : draft.status === "blocked";
  const name = real ? draft.payeeName : draft.sender.name;
  const purpose = draft.purpose;
  const checksLine = real
    ? (draft.safetySummary ?? (blocked ? "Blocked by the safety engine" : "Needs your tap"))
    : `${draft.checks.filter((c) => c.state === "pass").length}/${draft.checks.length} checks passed${blocked ? " · above your vendor cap" : " · needs your tap"}`;

  return (
    <div className="mt-2 overflow-hidden rounded-xl border border-mist/70 bg-paper">
      <div className="flex items-center justify-between gap-2 border-b border-mist/60 px-3 py-2">
        <span className="truncate rounded-md bg-fog px-1.5 py-0.5 font-mono text-[10px] text-graphite">
          DRAFT · {id}
        </span>
        <span className={`shrink-0 text-[10px] font-medium uppercase tracking-[0.08em] ${blocked ? "text-red-600" : "text-steel"}`}>
          {blocked ? "blocked" : real ? String(draft.status ?? "pending").toLowerCase() : "pending"}
        </span>
      </div>
      <div className="px-3 py-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-semibold text-ink">{name}</p>
            <p className="truncate text-[11px] text-pewter">{purpose}</p>
          </div>
          <Money amount={draft.amount} currency={draft.currency} className="shrink-0 text-[15px] font-semibold text-ink" />
        </div>
        {real && (draft.riskFlags ?? []).length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {(draft.riskFlags ?? []).map((f) => (
              <RiskChip key={f} type={riskType(f)} label={riskLabel(f)} />
            ))}
            {draft.policyVerdict ? (
              <span className="rounded-md bg-fog px-1.5 py-0.5 text-[10px] font-semibold text-ink">{draft.policyVerdict}</span>
            ) : null}
          </div>
        ) : null}
        <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-4 text-graphite">
          <ShieldCheck className="mt-px h-3 w-3 shrink-0 text-steel" />
          {checksLine}
        </p>
        <Link
          to="/approvals"
          className="mt-2.5 inline-flex items-center gap-1 rounded-lg border border-mist/80 px-2.5 py-1.5 text-[11.5px] font-medium text-ink hover:bg-fog"
        >
          Review in Approvals
          <ArrowUpRight className="h-3 w-3 text-steel" />
        </Link>
      </div>
    </div>
  );
}
