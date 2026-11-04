import { cn } from "@/lib/utils";

const TONES = {
  pending: { cls: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500", label: "Pending" },
  approved: { cls: "bg-blue-50 text-blue-700 ring-blue-200", dot: "bg-blue-500", label: "Approved" },
  executing: { cls: "bg-violet-50 text-violet-700 ring-violet-200", dot: "bg-violet-500", label: "Executing" },
  executed: { cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", dot: "bg-emerald-500", label: "Executed" },
  failed: { cls: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500", label: "Failed" },
  blocked: { cls: "bg-red-50 text-red-700 ring-red-200", dot: "bg-red-500", label: "Blocked" },
  ignored: { cls: "bg-fog text-graphite ring-mist/70", dot: "bg-steel", label: "Ignored" },
  expired: { cls: "bg-fog text-graphite ring-mist/70", dot: "bg-steel", label: "Expired" },
  neutral: { cls: "bg-fog text-graphite ring-mist/70", dot: "bg-steel", label: "Neutral" },
};

export default function StatusPill({ status = "pending", label, className, pulse }) {
  const tone = TONES[status] ?? TONES.neutral;
  const isPulsing = pulse ?? status === "executing";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        tone.cls,
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", tone.dot, isPulsing && "animate-pulse")} />
      {label ?? tone.label}
    </span>
  );
}