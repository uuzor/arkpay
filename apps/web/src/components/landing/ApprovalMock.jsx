import { ArrowDown, Check } from "lucide-react";
import RiskChip from "@/components/arkay/RiskChip";
import Money from "@/components/arkay/Money";

/**
 * The whole product in one glance: a money email arrives, ArkPay prepares the
 * approval card, one tap turns it into a PayPal receipt.
 */
export default function ApprovalMock() {
  return (
    <div className="relative mx-auto w-full max-w-[400px]">
      {/* Incoming email */}
      <div className="max-w-[85%] rounded-[10px] border border-silver/60 bg-paper p-3 shadow-quo">
        <p className="text-[10.5px] font-medium text-pewter">lagosprint@gmail.com · inbox</p>
        <p className="mt-1 text-[13px] leading-snug text-ink">
          “Please send the invoice for the flyers — <span className="font-semibold">$450</span>, same as agreed.”
        </p>
      </div>

      <div className="flex py-1.5 pl-8">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-paper">
          <ArrowDown className="h-3 w-3" />
        </span>
      </div>

      {/* Approval card */}
      <div className="ml-8 rounded-[12px] border border-silver/60 bg-paper p-4 shadow-quo">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-[6px] bg-ink font-dm text-[10px] font-bold text-paper">A</span>
            <span className="text-[12px] font-medium text-graphite">ArkPay agent</span>
          </div>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" /> live
          </span>
        </div>

        <p className="mt-3 text-[12px] text-pewter">Client asked for an invoice</p>
        <div className="mt-1 flex items-end gap-2">
          <Money amount={450} className="font-dm text-[32px] font-semibold leading-none text-ink" />
          <span className="pb-1 text-[12px] text-steel">USD</span>
        </div>
        <p className="mt-1 text-[13px] text-graphite">Flyer design · 500 units, delivered Tuesday</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <RiskChip type="known" />
          <RiskChip type="note" label="Confidence 96%" />
        </div>

        <div className="mt-4 grid grid-cols-[1.4fr_1fr_1fr] gap-2">
          <span className="inline-flex items-center justify-center gap-1.5 rounded-[10px] bg-ink px-3 py-2 text-[13px] font-semibold text-paper">
            <Check className="h-3.5 w-3.5" strokeWidth={3} /> Approve
          </span>
          <span className="rounded-[10px] border border-silver/70 px-3 py-2 text-center text-[13px] font-medium text-ink">Edit</span>
          <span className="rounded-[10px] px-3 py-2 text-center text-[13px] font-medium text-steel">Ignore</span>
        </div>
      </div>

      <div className="flex justify-end py-1.5 pr-8">
        <span className="grid h-6 w-6 place-items-center rounded-full bg-ink text-paper">
          <ArrowDown className="h-3 w-3" />
        </span>
      </div>

      {/* Receipt */}
      <div className="ml-auto flex max-w-[85%] items-center gap-2 rounded-[10px] bg-ink p-3 text-paper shadow-quo">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-highlighter text-ink">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
        <p className="text-[12.5px] font-medium">Invoice sent · INV2-0042 · PayPal sandbox</p>
      </div>
    </div>
  );
}
