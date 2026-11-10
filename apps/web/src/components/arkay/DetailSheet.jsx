import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

/**
 * Shared right-side sheet for detail views (request, invoice, payout,
 * retainer, dispute). Same primitive + motion as ApprovalDrawer, slightly
 * wider for dense content. Stacks on mobile.
 */
export default function DetailSheet({ open, onOpenChange, title, children }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[520px]">
        <SheetHeader className="sticky top-0 z-10 border-b border-mist/60 bg-paper px-5 py-3.5 text-left">
          <SheetTitle className="truncate text-[14px] font-semibold text-ink">
            {title ?? "Details"}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-5 py-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
