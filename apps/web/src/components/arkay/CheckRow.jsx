  import { Check, X, AlertTriangle } from "lucide-react";
  import { cn } from "@/lib/utils";

  const STATES = {
    pass: { icon: Check, cls: "text-emerald-600", ring: "bg-emerald-50 ring-emerald-100" },
    fail: { icon: X, cls: "text-red-600", ring: "bg-red-50 ring-red-100" },
    warn: { icon: AlertTriangle, cls: "text-amber-600", ring: "bg-amber-50 ring-amber-100" },
  };

  export default function CheckRow({ label, detail, state = "pass", className }) {
    const tone = STATES[state] ?? STATES.pass;
    const Icon = tone.icon;
    return (
      <div className={cn("flex items-start gap-3 py-2", className)}>
        <span className={cn("mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ring-1", tone.ring)}>
          <Icon className={cn("h-3 w-3", tone.cls)} strokeWidth={3} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-5 text-ink">{label}</p>
          {detail ? <p className="text-[11px] leading-4 text-pewter">{detail}</p> : null}
        </div>
      </div>
    );
  }