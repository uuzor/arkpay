import { Link } from "@tanstack/react-router";

const COLUMNS = [
  {
    title: "Product",
    links: ["Overview", "Requests", "Payroll", "Contacts", "Audit log"],
  },
  {
    title: "Safety",
    links: ["Payment Safety Engine", "Approval locking", "Prompt-injection defences", "Spending caps"],
  },
  {
    title: "Company",
    links: ["About", "Hackathon build", "Roadmap", "Contact"],
  },
  {
    title: "Resources",
    links: ["How it works", "Pricing", "Privacy policy", "Status"],
  },
];

export default function SiteFooter() {
  return (
    <footer className="bg-ink">
      <div className="mx-auto max-w-[1200px] px-6 py-16">
        <div className="grid gap-12 lg:grid-cols-[1fr_2fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-paper font-dm text-[13px] font-bold text-ink">A</span>
              <span className="font-dm text-[18px] font-semibold tracking-tight text-paper">ArkPay</span>
            </div>
            <p className="mt-4 max-w-[280px] text-[13px] leading-[1.65] text-paper/70">
              One shared place for money requests, approvals, and PayPal actions — so nothing gets missed.
            </p>
            <p className="mt-4 inline-flex items-center gap-2 rounded-[8px] bg-paper/10 px-2.5 py-1.5 text-[11.5px] font-medium text-paper/85">
              <span className="h-1.5 w-1.5 rounded-full bg-highlighter" />
              Built for the PayPal AI Hackathon
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <p className="font-dm text-[14px] font-semibold tracking-tight text-paper">{c.title}</p>
                <ul className="mt-3 space-y-2">
                  {c.links.map((l) => (
                    <li key={l}>
                      <span className="cursor-default text-[13px] text-paper/60 transition-colors hover:text-paper">{l}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-col gap-2 border-t border-paper/10 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="text-[12px] text-paper/50">© 2026 ArkPay. Demo build — PayPal sandbox only, no live money moves.</p>
            <Link to="/privacy" className="text-[12px] text-paper/65 underline-offset-4 hover:text-paper hover:underline">
              Privacy policy
            </Link>
          </div>
          <p className="font-mono text-[11px] text-paper/40">Lagos, Nigeria</p>
        </div>
      </div>
    </footer>
  );
}
