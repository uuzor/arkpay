import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import SectionTabs from "@/components/arkay/SectionTabs";
import RequestsPanel from "@/components/arkay/RequestsPanel";
import ApprovalsPanel from "@/components/arkay/ApprovalsPanel";
import RequestSheet from "@/components/arkay/RequestSheet";
import { approvalsQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authed/inbox")({
  validateSearch: (search) => ({
    tab: search?.tab === "approvals" ? "approvals" : "emails",
  }),
  head: () => ({ meta: [{ title: "Inbox · Arkay" }] }),
  component: InboxPage,
});

function InboxPage() {
  const { tab } = Route.useSearch();
  const [emailId, setEmailId] = useState(null);
  const { data: pending } = useQuery(approvalsQuery("PENDING_APPROVAL", 1));

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[22px] font-semibold tracking-[-0.03em] text-ink">Inbox</h1>
        <p className="mt-1 text-[12.5px] text-pewter">
          Money emails on the left, your approval queue on the right. Rows open beside the list.
        </p>
      </header>

      <SectionTabs
        to="/inbox"
        active={tab}
        tabs={[
          { value: "emails", label: "Emails" },
          { value: "approvals", label: "Approvals", count: pending?.totalCount ?? undefined },
        ]}
      />

      {tab === "approvals" ? (
        <ApprovalsPanel />
      ) : (
        <RequestsPanel onSelectEmail={setEmailId} selectedEmailId={emailId} />
      )}

      <RequestSheet emailId={emailId} open={Boolean(emailId)} onOpenChange={(v) => !v && setEmailId(null)} />
    </div>
  );
}
