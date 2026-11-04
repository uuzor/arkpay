import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { apiJson } from "@/lib/api";

const KINDS = [
  { value: "PAYROLL_PREPARE", label: "Payroll prep", hint: "Assemble the monthly team batch for review. Never sends." },
  { value: "INVOICE_REMINDERS", label: "Invoice reminders", hint: "Chase overdue invoices politely." },
  { value: "NOTIFY", label: "Notify", hint: "Send a Telegram note. Needs message text below." },
  { value: "AGENT_TASK", label: "Agent task (read-only)", hint: "The agent reasons over the prompt with money tools stripped and no saved history." },
  { value: "NOOP", label: "No-op", hint: "Heartbeat run that does nothing." },
];

const TRIGGERS = [
  { value: "ONCE", label: "Once" },
  { value: "INTERVAL", label: "Interval" },
  { value: "CRON", label: "Cron" },
];

export default function NewScheduleDialog({ open, onOpenChange }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [kind, setKind] = useState("NOTIFY");
  const [trigger, setTrigger] = useState("CRON");
  const [cron, setCron] = useState("0 9 * * *");
  const [timezone, setTimezone] = useState("UTC");
  const [intervalMinutes, setIntervalMinutes] = useState("60");
  const [runAt, setRunAt] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const reset = () => {
    setTitle("");
    setDetail("");
    setKind("NOTIFY");
    setTrigger("CRON");
    setCron("0 9 * * *");
    setTimezone("UTC");
    setIntervalMinutes("60");
    setRunAt("");
    setText("");
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const body = {
        title: title.trim(),
        detail: detail.trim(),
        kind,
        trigger,
        timezone: timezone.trim() || "UTC",
        ...(trigger === "CRON" ? { cron: cron.trim() } : {}),
        ...(trigger === "INTERVAL" ? { intervalMinutes: Number(intervalMinutes) } : {}),
        ...(trigger === "ONCE" ? { runAt: runAt ? new Date(runAt).toISOString() : undefined } : {}),
        ...(kind === "NOTIFY" ? { payload: { text: text.trim() } } : {}),
      };
      await apiJson("/schedules", { method: "POST", body });
      toast("Schedule created");
      queryClient.invalidateQueries({ queryKey: ["schedules"] });
      reset();
      onOpenChange(false);
    } catch (e) {
      const msg = e?.message ?? "Could not create the schedule.";
      setError(msg);
      toast("Create failed", { description: msg });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="max-h-[90vh] max-w-[480px] overflow-auto rounded-xl">
        <DialogHeader>
          <DialogTitle className="text-[16px] tracking-[-0.02em]">New schedule</DialogTitle>
          <DialogDescription className="text-[12.5px] leading-5 text-graphite">
            Schedules prepare and notify — they never move money on their own.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Title</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Morning invoice chase" className="mt-1 h-9 rounded-xl" />
          </div>
          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">
              Detail{kind === "AGENT_TASK" ? " (the agent prompt)" : ""}
            </label>
            <Input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What this schedule is for" className="mt-1 h-9 rounded-xl" />
          </div>

          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Handler</label>
            <div className="mt-1.5 space-y-1.5">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  className={cn(
                    "w-full rounded-lg border p-2.5 text-left transition-colors",
                    kind === k.value ? "border-ink/60 bg-fog/70" : "border-mist/70 hover:bg-fog/40",
                  )}
                >
                  <p className="text-[12.5px] font-medium text-ink">{k.label}</p>
                  <p className="text-[11px] leading-4 text-pewter">{k.hint}</p>
                </button>
              ))}
            </div>
          </div>

          {kind === "NOTIFY" ? (
            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Message text</label>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Books close Friday — nudge the team" className="mt-1 h-9 rounded-xl" />
            </div>
          ) : null}

          <div>
            <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Trigger</label>
            <div className="mt-1.5 flex gap-1 rounded-xl bg-fog p-1">
              {TRIGGERS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTrigger(t.value)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
                    trigger === t.value ? "bg-paper text-ink shadow-sm" : "text-graphite hover:text-ink",
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {trigger === "CRON" ? (
            <div className="grid grid-cols-[1fr_120px] gap-2">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Cron</label>
                <Input value={cron} onChange={(e) => setCron(e.target.value)} placeholder="0 9 * * *" className="mt-1 h-9 rounded-xl font-mono" />
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Timezone</label>
                <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="UTC" className="mt-1 h-9 rounded-xl" />
              </div>
            </div>
          ) : null}
          {trigger === "INTERVAL" ? (
            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Every N minutes</label>
              <Input value={intervalMinutes} onChange={(e) => setIntervalMinutes(e.target.value)} inputMode="numeric" className="mt-1 h-9 w-28 rounded-xl tabular" />
            </div>
          ) : null}
          {trigger === "ONCE" ? (
            <div>
              <label className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Run at</label>
              <Input type="datetime-local" value={runAt} onChange={(e) => setRunAt(e.target.value)} className="mt-1 h-9 rounded-xl" />
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[11.5px] font-medium leading-5 text-red-700 ring-1 ring-inset ring-red-100">
              {error}
            </p>
          ) : null}
        </div>

        <div className="mt-1 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-xl border border-mist/80 px-3 py-2 text-[12.5px] font-medium text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-xl bg-ink px-3 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-50"
          >
            {saving ? "Creating…" : "Create schedule"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
