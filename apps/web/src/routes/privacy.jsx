import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy policy · Arkay" },
      {
        name: "description",
        content:
          "How Arkay collects, uses and protects workspace, contact and payment-request data, and the choices you have over it.",
      },
    ],
  }),
  component: PrivacyPage,
});

const SECTIONS = [
  {
    title: "1. What Arkay is",
    body: [
      "Arkay is an AI payments agent for freelancers and micro-businesses. It reads money requests that arrive in your inbox or chat, prepares the matching PayPal invoice or payout, asks you for one secure approval, and executes it.",
      "This build runs in sandbox mode: the workspace you see is sample data and no live money moves. The handling described below is what applies when a workspace is connected to a live PayPal account.",
    ],
  },
  {
    title: "2. Information we process",
    list: [
      "Workspace and account details — your name, email address, workspace name, and the people you invite.",
      "Money-request content — the sender's name and email, subject, message body, attachments, and any amounts, currencies, dates or references it contains.",
      "Contact records you keep in Arkay — payee names, emails and the PayPal addresses you have paid before.",
      "Activity records — approvals, edits, rejections, execution attempts, and the resulting PayPal transaction references.",
      "Technical data needed to run the service securely, such as sign-in sessions and error records.",
    ],
  },
  {
    title: "3. What we don't handle",
    body: [
      "Arkay never asks for and never stores your PayPal password, card numbers or bank credentials. You authorize PayPal through PayPal's own pages, and we receive only the connection it grants us.",
    ],
  },
  {
    title: "4. How we use it",
    list: [
      "To turn a money request into a structured, checkable action you can approve or edit.",
      "To run the safety checks — known payee, payee change, duplicates, amount anomalies, spending caps and currency allow-list.",
      "To execute the action on PayPal once you approve it, and to keep an audit record of what happened.",
      "To protect the workspace: detecting injection attempts and unusual activity, and keeping approvals single-use.",
    ],
  },
  {
    title: "5. AI processing",
    body: [
      "Message content is sent to a language model to extract structured fields such as the payee, amount and purpose. The model only returns that structured output — it cannot approve, edit, or send money. Every extracted field is then validated in code before an action is built.",
      "Incoming messages are treated strictly as untrusted data. Instructions found inside an email are never followed.",
    ],
  },
  {
    title: "6. Sharing",
    list: [
      "PayPal — to create the invoice or payout you approved, and to confirm its status.",
      "Service providers that host, run and secure Arkay's infrastructure and AI inference, under contracts that limit their use of the data.",
      "Authorities, only where the law requires it.",
      "We do not sell personal data, and we do not share your contacts or message content for advertising.",
    ],
  },
  {
    title: "7. Retention",
    body: [
      "Approval and execution records are kept so you and your accountant can reconstruct what happened. Message bodies and extracted fields are kept with the request they belong to. When you delete a request or contact, we remove it from the active workspace; backups roll off on a short cycle.",
    ],
  },
  {
    title: "8. Security",
    list: [
      "Approvals are hashed over the exact action they cover — amount, payee and purpose. Change any of them and the old approval is void.",
      "Every execution carries an idempotency key, so a retry can never pay twice.",
      "Access to a workspace is limited to its members, and sensitive actions require the role that allows them.",
      "The audit trail records approvals, edits and executions, and is read-only inside the app.",
    ],
  },
  {
    title: "9. Your choices",
    list: [
      "Access, correct or delete your contacts and requests from the workspace at any time.",
      "Disconnect the PayPal connection, which stops any further execution.",
      "Ask for a copy of your workspace data, or for the workspace to be closed and its data erased.",
    ],
  },
  {
    title: "10. Changes and contact",
    body: [
      "If this policy changes in a way that affects how your data is used, we will tell workspace owners before the change takes effect.",
      "Questions about privacy, or a request about your data, can be raised through the Contact link in your workspace.",
    ],
  },
];

function PrivacyPage() {
  const { isAuthenticated } = useAuth();
  return (
    <div className="min-h-screen bg-paper">
      <header className="border-b border-mist/60">
        <div className="mx-auto flex h-14 max-w-[760px] items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-ink text-[11px] font-semibold text-paper">A</span>
            <span className="text-[15px] font-semibold tracking-[-0.03em] text-ink">Arkay</span>
          </Link>
          <Link
            to={isAuthenticated ? "/overview" : "/"}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium text-graphite hover:text-ink"
          >
            <ArrowLeft className="h-3.5 w-3.5" />{" "}
            {isAuthenticated ? "Back to dashboard" : "Back to site"}
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-[760px] px-6 py-12">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-steel">Legal</p>
        <h1 className="mt-2 text-[32px] font-semibold tracking-[-0.035em] text-ink sm:text-[38px]">
          Privacy policy
        </h1>
        <p className="mt-3 max-w-[560px] text-[14px] leading-7 text-pewter">
          How Arkay handles the messages, contacts and payment details that pass through your workspace.
        </p>
        <p className="mt-2 font-mono text-[11px] text-steel">Last updated 3 November 2026</p>

        <div className="mt-10 space-y-9">
          {SECTIONS.map((s) => (
            <section key={s.title}>
              <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{s.title}</h2>
              {s.body?.map((p) => (
                <p key={p} className="mt-2.5 text-[13.5px] leading-7 text-graphite">
                  {p}
                </p>
              ))}
              {s.list ? (
                <ul className="mt-3 space-y-2">
                  {s.list.map((item) => (
                    <li key={item} className="flex gap-2.5 text-[13.5px] leading-7 text-graphite">
                      <span className="mt-[11px] h-1 w-1 shrink-0 rounded-full bg-mist" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-xl border border-mist/70 bg-fog/60 px-4 py-3">
          <p className="text-[12px] leading-6 text-graphite">
            This is a demo build for the PayPal AI Hackathon. Everything in the workspace is sample data, and
            PayPal runs in sandbox — no real money moves.
          </p>
        </div>
      </main>

      <footer className="border-t border-mist/60">
        <div className="mx-auto flex max-w-[760px] flex-col gap-2 px-6 py-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[11.5px] text-steel">© 2026 Arkay. Demo build — PayPal sandbox only.</p>
          <Link to="/" className="text-[11.5px] font-medium text-graphite hover:text-ink">
            arkay.app
          </Link>
        </div>
      </footer>
    </div>
  );
}