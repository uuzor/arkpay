import { cn } from "@/lib/utils";
import StatusPill from "@/components/arkay/StatusPill";
import { emailTone, timeAgo } from "@/lib/actionShapes";

function senderName(from) {
  if (!from) return "Unknown sender";
  const m = String(from).match(/^\s*"?([^"<]+)"?\s*</);
  if (m) return m[1].trim();
  return String(from).split("@")[0] || String(from);
}

function RowInner({ email, tone }) {
  return (
    <>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13px] font-medium text-ink">{senderName(email.from)}</span>
          {(email.actions ?? []).length > 0 ? (
            <span className="shrink-0 rounded-md bg-fog px-1.5 py-px text-[10px] font-medium text-graphite">
              {email.actions.length} action{email.actions.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <p className="mt-0.5 truncate text-[12.5px] text-graphite">{email.subject || "(no subject)"}</p>
        <p className="truncate text-[11.5px] text-pewter">{email.snippet}</p>
        {(email.actions ?? []).length > 0 ? (
          <p className="mt-0.5 truncate font-mono text-[10px] text-steel">
            {email.actions.map((a) => `${a.type} · ${a.status}`).join("  ·  ")}
          </p>
        ) : null}
      </div>

      <div>
        <span className="text-[11.5px] text-steel" title={email.receivedAt ? new Date(email.receivedAt).toLocaleString() : ""}>
          {email.receivedAt ? timeAgo(email.receivedAt) : "—"}
        </span>
      </div>

      <div className="md:text-right">
        <StatusPill status={tone.status} label={tone.label} />
      </div>
    </>
  );
}

export default function RequestTable({ emails = [], onSelect, selectedId }) {
  if (!emails.length) {
    return (
      <div className="rounded-xl border border-mist/70 bg-paper px-4 py-10 text-center">
        <p className="text-[13px] font-medium text-ink">Nothing here</p>
        <p className="mt-1 text-[12px] text-pewter">No emails match this filter. New mail appears after the next sync.</p>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-mist/70 bg-paper">
      <div className="hidden grid-cols-[minmax(0,1fr)_120px_110px] gap-3 border-b border-mist/60 px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-[0.1em] text-steel md:grid">
        <span>Email</span>
        <span>Received</span>
        <span className="text-right">Status</span>
      </div>
      <ul className="divide-y divide-mist/50">
        {emails.map((email) => {
          const tone = emailTone(email.status);
          const cls = cn(
            "grid w-full grid-cols-1 gap-2 px-4 py-3 text-left transition-colors hover:bg-fog/50 md:grid-cols-[minmax(0,1fr)_120px_110px] md:items-center md:gap-3",
            selectedId === email.id && "bg-fog/60",
          );
          return (
            <li key={email.id}>
              <button type="button" onClick={() => onSelect?.(email.id)} className={cls}>
                <RowInner email={email} tone={tone} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
