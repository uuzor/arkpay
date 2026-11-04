import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowLeft, Play } from "lucide-react";
import StatusPill from "@/components/arkay/StatusPill";
import Money from "@/components/arkay/Money";
import { apiJson } from "@/lib/api";
import { actionTone, actionTypeLabel, emailTone, timeAgo } from "@/lib/actionShapes";
import { emailDetailQuery } from "@/lib/queries";

export const Route = createFileRoute("/_authed/requests_/$requestId")({
  head: () => ({ meta: [{ title: "Request · Arkay" }] }),
  component: RequestDetailPage,
});

function ExtractedJson({ value }) {
  if (!value || typeof value !== "object") {
    return <p className="text-[12px] text-pewter">No extraction stored for this email yet.</p>;
  }
  const entries = Object.entries(value);
  if (!entries.length) return <p className="text-[12px] text-pewter">Extraction is empty.</p>;
  return (
    <div className="space-y-1 font-mono text-[11.5px] leading-6">
      {entries.map(([k, v]) => (
        <div key={k} className="flex gap-2">
          <span className="shrink-0 text-steel">"{k}":</span>
          <span className="break-all text-ink">
            {v == null ? "null" : typeof v === "object" ? JSON.stringify(v) : `"${v}"`}
          </span>
        </div>
      ))}
    </div>
  );
}

function RequestDetailPage() {
  const { requestId } = Route.useParams();
  const queryClient = useQueryClient();
  const [piping, setPiping] = useState(false);
  const { data: email, isLoading, isError, error } = useQuery(emailDetailQuery(requestId));

  const runPipeline = async () => {
    setPiping(true);
    try {
      const res = await apiJson("/pipeline/run", { method: "POST", body: { limit: 5 } });
      if (res?.skipped) {
        toast("Pipeline already running", { description: "A run is in progress — try again in a moment." });
      } else {
        toast("Pipeline run finished", {
          description: `${res?.processed ?? 0} processed · ${res?.carded ?? 0} carded · ${res?.blocked ?? 0} blocked · ${res?.ignored ?? 0} ignored · ${res?.needsReview ?? 0} need review.`,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["emails"] });
      queryClient.invalidateQueries({ queryKey: ["approvals"] });
    } catch (e) {
      toast("Pipeline run failed", { description: e?.message ?? "Could not run the pipeline." });
    } finally {
      setPiping(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-36 animate-pulse rounded-xl bg-fog" />
        <div className="h-64 animate-pulse rounded-xl bg-fog" />
      </div>
    );
  }

  if (isError || !email) {
    const notFound = error?.status === 404;
    return (
      <div className="rounded-xl border border-mist/70 bg-paper px-4 py-12 text-center">
        <p className="text-[14px] font-semibold text-ink">{notFound ? "Email not found" : "Could not load this email"}</p>
        <p className="mt-1 text-[12px] text-pewter">
          {notFound ? "It may belong to another workspace." : (error?.message ?? "Unknown error.")}
        </p>
        <Link to="/requests" className="mt-4 inline-block rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper">
          Back to requests
        </Link>
      </div>
    );
  }

  const tone = emailTone(email.status);
  const actions = email.actions ?? [];
  const extracted = actions.find((a) => a.extractedJson)?.extractedJson ?? null;
  const canReprocess = email.status === "NEW" || email.status === "NEEDS_REVIEW";

  return (
    <div className="space-y-4">
      <Link to="/requests" className="inline-flex items-center gap-1.5 text-[12px] font-medium text-graphite hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> All requests
      </Link>

      <div className="rounded-xl border border-mist/70 bg-paper">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-mist/60 px-4 py-4 sm:px-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-steel">{email.gmailId ?? email.id}</span>
              <StatusPill status={tone.status} label={tone.label} />
            </div>
            <h1 className="mt-2 break-words text-[20px] font-semibold tracking-[-0.03em] text-ink">
              {email.subject || "(no subject)"}
            </h1>
            <p className="mt-0.5 break-words text-[12px] text-pewter">
              {email.from} · received {email.receivedAt ? timeAgo(email.receivedAt) : "—"}
            </p>
          </div>
          {canReprocess ? (
            <button
              type="button"
              onClick={runPipeline}
              disabled={piping}
              className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3.5 py-2 text-[12.5px] font-semibold text-paper disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" /> {piping ? "Running…" : "Run pipeline"}
            </button>
          ) : null}
        </div>

        {actions.length > 0 ? (
          <ul className="divide-y divide-mist/50">
            {actions.map((a) => {
              const t = actionTone(a.status);
              return (
                <li key={a.id}>
                  <Link
                    to="/approvals"
                    className="flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-fog/50 sm:px-5"
                  >
                    <span className="rounded-md bg-fog px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-graphite">
                      {actionTypeLabel(a.type)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {a.payeeName} · {a.purpose}
                      </span>
                      <span className="mt-0.5 block font-mono text-[10.5px] text-steel">
                        {a.id}
                        {a.confidence != null ? ` · confidence ${Math.round(a.confidence * 100)}%` : ""}
                        {a.policyVerdict ? ` · ${a.policyVerdict}` : ""}
                      </span>
                    </span>
                    <Money amount={a.amount} currency={a.currency} className="text-[13px] text-ink" />
                    <StatusPill status={t.status} label={t.label} />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="px-4 py-4 text-[12px] text-pewter sm:px-5">
            No actions were created from this email
            {email.status === "IGNORED" ? " — the pipeline classified it as noise." : " yet."}
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-mist/70 bg-paper">
          <div className="border-b border-mist/60 px-4 py-2.5">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">Raw message</h2>
          </div>
          <div className="px-4 py-3">
            <p className="break-words font-mono text-[10.5px] text-pewter">From: {email.from}</p>
            <p className="break-words font-mono text-[10.5px] text-pewter">Subject: {email.subject}</p>
            <pre className="mt-2.5 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-lg bg-fog/70 p-3 font-mono text-[11.5px] leading-6 text-graphite">
              {email.body}
            </pre>
            <p className="mt-2 text-[10.5px] text-steel">
              Treated as untrusted data — never as instructions to the agent.
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-mist/70 bg-paper">
          <div className="flex items-center justify-between border-b border-mist/60 px-4 py-2.5">
            <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-steel">Extracted fields</h2>
            <span className="font-mono text-[10px] text-steel">schema · no tools</span>
          </div>
          <div className="px-4 py-3">
            <ExtractedJson value={extracted} />
          </div>
        </div>
      </div>
    </div>
  );
}
