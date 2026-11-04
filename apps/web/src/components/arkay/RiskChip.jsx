import { UserPlus, Repeat, Copy, TrendingUp, ShieldAlert, Timer, Check, Flag } from "lucide-react";
import { cn } from "@/lib/utils";

const RISKS = {
  new_payee: { label: "New payee", cls: "bg-amber-50 text-amber-800 ring-amber-200", icon: UserPlus },
  changed_payee: { label: "Payee changed", cls: "bg-red-50 text-red-700 ring-red-200", icon: Repeat },
  duplicate: { label: "Possible duplicate", cls: "bg-red-50 text-red-700 ring-red-200", icon: Copy },
  amount_anomaly: { label: "Amount anomaly", cls: "bg-amber-50 text-amber-800 ring-amber-200", icon: TrendingUp },
  injection: { label: "Injection attempt", cls: "bg-red-50 text-red-700 ring-red-200", icon: ShieldAlert },
  urgency: { label: "Urgency pressure", cls: "bg-amber-50 text-amber-800 ring-amber-200", icon: Timer },
  known: { label: "Known contact", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200", icon: Check },
  note: { label: "Note", cls: "bg-fog text-graphite ring-mist/70", icon: Flag },
};

export default function RiskChip({ type = "note", label, className }) {
  const risk = RISKS[type] ?? RISKS.note;
  const Icon = risk.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset",
        risk.cls,
        className,
      )}
    >
      <Icon className="h-3 w-3" strokeWidth={2.2} />
      {label ?? risk.label}
    </span>
  );
}