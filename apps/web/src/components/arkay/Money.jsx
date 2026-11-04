import { cn } from "@/lib/utils";

export function formatMoney(amount, currency = "USD", opts = {}) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: opts.minimumFractionDigits ?? 2,
    maximumFractionDigits: opts.maximumFractionDigits ?? 2,
  }).format(Number(amount) || 0);
}

export default function Money({ amount, currency = "USD", className, minimumFractionDigits, plain }) {
  const value = formatMoney(amount, currency, { minimumFractionDigits });
  return (
    <span className={cn("tabular font-medium tracking-[-0.02em]", className)}>
      {plain ? value.replace(/[^\d.,]/g, "") : value}
    </span>
  );
}