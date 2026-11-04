import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, PencilLine, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";
import Money from "@/components/arkay/Money";
import StatusPill from "@/components/arkay/StatusPill";
import ApprovalDrawer from "@/components/arkay/ApprovalDrawer";
import ContactDialog from "@/components/arkay/ContactDialog";
import { actionTone, actionTypeLabel, timeAgo } from "@/lib/actionShapes";
import { contactDetailQuery, contactsQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authed/contacts")({
  head: () => ({ meta: [{ title: "Contacts · Arkay" }] }),
  component: ContactsPage,
});

const KINDS = [
  { value: null, label: "All" },
  { value: "CLIENT", label: "Client" },
  { value: "SUPPLIER", label: "Supplier" },
  { value: "STAFF", label: "Staff" },
];

function initials(name) {
  return String(name || "?")
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
}

function ContactDetail({ contactId, onAction }) {
  const detail = useQuery(contactDetailQuery(contactId));
  if (detail.isLoading) return <div className="h-20 animate-pulse rounded-lg bg-fog" />;
  if (detail.isError || !detail.data) {
    return <p className="text-[12px] text-red-700">Could not load contact: {detail.error?.message ?? "unknown error"}</p>;
  }
  const c = detail.data;
  const actions = c.actions ?? [];
  const total = c._count?.actions ?? actions.length;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          ["Payments", String(c.payCount ?? 0)],
          ["Usual", c.usualAmount != null ? `${c.currency ?? "USD"} ${c.usualAmount}` : "—"],
          ["Last paid", c.lastPaidAt ? timeAgo(c.lastPaidAt) : "never"],
          ["Known since", c.firstSeenAt ? new Date(c.firstSeenAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-mist/60 bg-paper px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-[0.1em] text-steel">{label}</p>
            <p className="mt-0.5 text-[12.5px] font-medium text-ink">{value}</p>
          </div>
        ))}
      </div>
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">
          Recent actions ({actions.length} of {total})
        </p>
        {actions.length === 0 ? (
          <p className="mt-1.5 text-[12px] text-pewter">No actions linked to this contact yet.</p>
        ) : (
          <ul className="mt-1.5 divide-y divide-mist/50 rounded-lg border border-mist/60 bg-paper">
            {actions.map((a) => {
              const tone = actionTone(a.status);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => onAction?.(a.id)}
                    className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-fog/50"
                  >
                    <span className="rounded-md bg-fog px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-graphite">
                      {actionTypeLabel(a.type)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{a.purpose}</span>
                    <Money amount={a.amount} currency={a.currency} className="text-[12px] text-ink" />
                    <StatusPill status={tone.status} label={tone.label} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function ContactsPage() {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState(null);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState(null);
  const [drawerId, setDrawerId] = useState(null);
  const [dialog, setDialog] = useState(null); // { mode: 'create' } | { mode: 'edit', contact }

  const list = useQuery(contactsQuery(kind));
  useEffect(() => {
    setOpenId(null);
  }, [kind]);

  const q = query.trim().toLowerCase();
  const rows = (list.data ?? []).filter(
    (c) =>
      !q ||
      c.name.toLowerCase().includes(q) ||
      (c.paypalEmail ?? "").toLowerCase().includes(q),
  );

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["contacts"] });

  const save = async (values) => {
    if (dialog?.mode === "edit") {
      await apiJson(`/contacts/${encodeURIComponent(dialog.contact.id)}`, { method: "PATCH", body: values });
      toast("Contact updated");
    } else {
      await apiJson("/contacts", { method: "POST", body: values });
      toast("Contact saved");
    }
    setDialog(null);
    refresh();
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Contacts</h1>
          <p className="mt-1 text-[12.5px] text-pewter">
            Your people book — PayPal emails and IDs only, never bank details. Anything that changes gets highlighted.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDialog({ mode: "create" })}
          className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper"
        >
          <Plus className="h-3.5 w-3.5" /> New contact
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {KINDS.map((k) => (
            <button
              key={k.label}
              type="button"
              onClick={() => setKind(k.value)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors",
                kind === k.value ? "bg-ink text-paper" : "bg-paper text-graphite ring-1 ring-inset ring-mist/70 hover:text-ink",
              )}
            >
              {k.label}
            </button>
          ))}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or PayPal email"
          className="ml-auto h-8 w-full rounded-lg border border-mist/80 bg-paper px-2.5 text-[12px] text-ink outline-none placeholder:text-steel focus:border-ink/40 sm:w-[240px]"
        />
      </div>

      {list.isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-fog" />
          ))}
        </div>
      ) : list.isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-[12.5px] text-red-800">
          Could not load contacts: {list.error?.message ?? "unknown error"}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-mist/70 bg-paper px-4 py-10 text-center">
          <p className="text-[13px] font-medium text-ink">
            {q || kind ? "No contacts match" : "No contacts yet"}
          </p>
          <p className="mt-1 text-[12px] text-pewter">
            {q || kind
              ? "Try a different search or filter."
              : "Contacts appear automatically the first time someone is paid or billed — or add one manually above."}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
          <div className="hidden grid-cols-[minmax(0,1.4fr)_90px_minmax(0,1.3fr)_110px_110px_28px] gap-3 border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel md:grid">
            <span>Contact</span>
            <span>Kind</span>
            <span>PayPal</span>
            <span className="text-right">Usual</span>
            <span className="text-right">Last paid</span>
            <span />
          </div>
          <ul className="divide-y divide-mist/50">
            {rows.map((c) => {
              const open = openId === c.id;
              return (
                <li key={c.id}>
                  <div className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_90px_minmax(0,1.3fr)_110px_110px_28px] md:items-center md:gap-3">
                    <button
                      type="button"
                      onClick={() => setOpenId(open ? null : c.id)}
                      className="flex min-w-0 items-center gap-2.5 text-left"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-fog text-[10px] font-semibold text-graphite">
                        {initials(c.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-medium text-ink">{c.name}</span>
                        <span className="block truncate text-[10.5px] text-pewter">
                          {c.payCount ?? 0} payment{(c.payCount ?? 0) === 1 ? "" : "s"} on record
                          {(c.payCount ?? 0) === 0 ? " · new contact" : ""}
                        </span>
                      </span>
                    </button>

                    <div>
                      <span className="rounded-md bg-fog px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-graphite">
                        {String(c.kind).toLowerCase()}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <p className="truncate font-mono text-[11px] text-graphite">{c.paypalEmail ?? "—"}</p>
                    </div>

                    <div className="md:text-right">
                      {c.usualAmount != null ? (
                        <Money amount={c.usualAmount} currency={c.currency} className="text-[12.5px] text-ink" />
                      ) : (
                        <span className="text-[11.5px] text-steel">No history</span>
                      )}
                    </div>

                    <div className="md:text-right">
                      <span className="text-[11.5px] text-graphite">
                        {c.lastPaidAt
                          ? new Date(c.lastPaidAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" })
                          : "Never"}
                      </span>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setDialog({ mode: "edit", contact: c })}
                        title="Edit contact"
                        aria-label={`Edit ${c.name}`}
                        className="grid h-7 w-7 place-items-center rounded-lg text-steel transition-colors hover:bg-fog hover:text-ink"
                      >
                        <PencilLine className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setOpenId(open ? null : c.id)}
                        title="History"
                        aria-label={`History of ${c.name}`}
                        className="grid h-7 w-7 place-items-center rounded-lg text-steel transition-colors hover:bg-fog"
                      >
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
                      </button>
                    </div>
                  </div>

                  {open ? (
                    <div className="border-t border-mist/40 bg-fog/40 px-4 py-3">
                      <ContactDetail contactId={c.id} onAction={setDrawerId} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <ContactDialog
        dialog={dialog}
        onClose={() => setDialog(null)}
        onSave={save}
      />
      <ApprovalDrawer actionId={drawerId} open={Boolean(drawerId)} onOpenChange={(v) => !v && setDrawerId(null)} />
    </div>
  );
}
