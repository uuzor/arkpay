import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import SectionTabs from "@/components/arkay/SectionTabs";
import InvoicesPanel from "@/components/arkay/InvoicesPanel";
import RetainersPanel from "@/components/arkay/RetainersPanel";
import DisputesPanel from "@/components/arkay/DisputesPanel";
import InvoiceSheet from "@/components/arkay/InvoiceSheet";
import RetainerSheet from "@/components/arkay/RetainerSheet";
import DisputeSheet from "@/components/arkay/DisputeSheet";

const TABS = ["invoices", "retainers", "disputes"];

export const Route = createFileRoute("/_authed/money")({
  validateSearch: (search) => ({
    tab: TABS.includes(search?.tab) ? search.tab : "invoices",
  }),
  head: () => ({ meta: [{ title: "Money in · Arkay" }] }),
  component: MoneyPage,
});

function MoneyPage() {
  const { tab } = Route.useSearch();
  const [invoiceId, setInvoiceId] = useState(null);
  const [subscriptionId, setSubscriptionId] = useState(null);
  const [disputeId, setDisputeId] = useState(null);

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Money in</h1>
        <p className="mt-1 text-[12.5px] text-pewter">
          Everything owed to you: invoices out, retainers billing, disputes to defend.
        </p>
      </header>

      <SectionTabs
        to="/money"
        active={tab}
        tabs={[
          { value: "invoices", label: "Invoices" },
          { value: "retainers", label: "Retainers" },
          { value: "disputes", label: "Disputes" },
        ]}
      />

      {tab === "retainers" ? (
        <RetainersPanel onSelectSubscription={setSubscriptionId} selectedSubscriptionId={subscriptionId} />
      ) : tab === "disputes" ? (
        <DisputesPanel onSelectDispute={setDisputeId} selectedDisputeId={disputeId} />
      ) : (
        <InvoicesPanel onSelectInvoice={setInvoiceId} selectedInvoiceId={invoiceId} />
      )}

      <InvoiceSheet invoiceId={invoiceId} open={Boolean(invoiceId)} onOpenChange={(v) => !v && setInvoiceId(null)} />
      <RetainerSheet
        subscriptionId={subscriptionId}
        open={Boolean(subscriptionId)}
        onOpenChange={(v) => !v && setSubscriptionId(null)}
      />
      <DisputeSheet disputeId={disputeId} open={Boolean(disputeId)} onOpenChange={(v) => !v && setDisputeId(null)} />
    </div>
  );
}
