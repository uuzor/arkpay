import { useState } from "react";
import {
  ChevronDown,
  Check,
  Loader2,
  AlertTriangle,
  Wallet,
  LayoutDashboard,
  Receipt,
  Search,
  ListChecks,
  Inbox,
  UserSearch,
  FileText,
  ArrowUpRight,
  SendHorizontal,
  ScrollText,
  CalendarClock,
  ShieldCheck,
  ShieldAlert,
  History,
  Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { summarizeInput, summarizeOutput, toolLabel } from "@/lib/chatTurns";

const TOOL_ICON = {
  get_paypal_balance: Wallet,
  get_account_summary: LayoutDashboard,
  get_spend: Receipt,
  search_paypal_transactions: Search,
  list_pending: ListChecks,
  search_emails: Inbox,
  lookup_contact: UserSearch,
  create_invoice_draft: FileText,
  request_payout: ArrowUpRight,
  follow_up_invoice: SendHorizontal,
  generate_statement: ScrollText,
  list_schedules: CalendarClock,
  get_safety_policy: ShieldCheck,
  list_blocked_actions: ShieldAlert,
  get_audit_trail: History,
};

function iconFor(name) {
  if (TOOL_ICON[name]) return TOOL_ICON[name];
  if (String(name).startsWith("paypal_")) return Wallet;
  return Wrench;
}

function ToolRow({ call }) {
  const [open, setOpen] = useState(false);
  const Icon = iconFor(call.name);
  const summary = summarizeInput(call.input);
  const output = call.status === "done" ? summarizeOutput(call.output) : "";
  return (
    <div className="rounded-lg border border-mist/60 bg-paper">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-mist/70 bg-fog/60">
          <Icon className="h-3 w-3 text-graphite" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[11.5px] font-medium text-ink">{toolLabel(call.name)}</span>
          {summary ? <span className="block truncate font-mono text-[10px] text-steel">{summary}</span> : null}
        </span>
        {call.status === "running" ? (
          <Loader2 className="h-3 w-3 shrink-0 animate-spin text-steel" />
        ) : call.status === "error" ? (
          <AlertTriangle className="h-3 w-3 shrink-0 text-red-500" />
        ) : (
          <Check className="h-3 w-3 shrink-0 text-emerald-600" strokeWidth={3} />
        )}
        <ChevronDown className={cn("h-3 w-3 shrink-0 text-steel transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="border-t border-mist/50 px-2 py-1.5">
          <p className="break-all font-mono text-[10px] leading-4 text-graphite">
            {output || (call.status === "running" ? "running…" : call.error || "—")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * chat.md-style collapsible tool group: "N actions" with a chevron, expanding
 * to one row per tool call with status + expandable output.
 */
export default function ToolCallGroup({ calls = [], defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  if (!calls.length) return null;
  const running = calls.filter((c) => c.status === "running").length;
  const failed = calls.filter((c) => c.status === "error").length;
  const Icon = iconFor(calls[0].name);
  return (
    <div className="overflow-hidden rounded-xl border border-mist/60 bg-fog/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors hover:bg-fog/60"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-mist/70 bg-paper shadow-[0_2px_1px_0_rgb(2_2_3_/_2%)]">
          <Icon className="h-3 w-3 text-graphite" strokeWidth={2} />
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-graphite">
          {calls.length} action{calls.length === 1 ? "" : "s"}
          {running ? ` · ${running} running` : ""}
          {failed ? ` · ${failed} failed` : ""}
        </span>
        {running ? <Loader2 className="h-3 w-3 shrink-0 animate-spin text-steel" /> : null}
        <ChevronDown className={cn("h-3.5 w-3.5 shrink-0 text-steel transition-transform", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="space-y-1.5 border-t border-mist/50 p-1.5">
          {calls.map((call) => (
            <ToolRow key={call.id} call={call} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
