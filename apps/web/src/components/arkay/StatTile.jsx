  import { cn } from "@/lib/utils";
  import Money from "@/components/arkay/Money";

  const TONES = {
    default: "text-ink",
    amber: "text-amber-700",
    red: "text-red-600",
    green: "text-emerald-700",
  };

  export default function StatTile({ label, value, money, currency = "USD", hint, tone = "default", className }) {
    return (
      <div className={cn("rounded-xl border border-mist/70 bg-paper p-4", className)}>
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">{label}</p>
        <p className={cn("mt-2 text-[25px] font-semibold leading-none tracking-[-0.03em] tabular", TONES[tone])}>
          {money !== undefined ? <Money amount={money} currency={currency} /> : value}
        </p>
        {hint ? <p className="mt-2 text-[11.5px] leading-4 text-pewter">{hint}</p> : null}
      </div>
    );
  }