import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Menu, X, ArrowRight } from "lucide-react";

const LINKS = [
  { label: "Product", href: "#product" },
  { label: "How it works", href: "#how" },
  { label: "Safety", href: "#safety" },
  { label: "Pricing", href: "#pricing" },
];

export default function SiteNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50">
      <div className="bg-ink">
        <div className="mx-auto flex max-w-[1200px] items-center justify-center gap-2 px-6 py-1.5 text-[12px] font-medium text-paper/90">
          <span className="hidden sm:inline">Built for the PayPal AI Hackathon</span>
          <span className="hidden h-3 w-px bg-paper/25 sm:inline-block" />
          <a href="#product" className="inline-flex items-center gap-1 text-highlighter hover:underline">
            See the agent in action <ArrowRight className="h-3 w-3" />
          </a>
        </div>
      </div>

      <div className="border-b border-silver/70 bg-paper/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center justify-between px-6">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-ink font-dm text-[13px] font-bold text-paper">A</span>
            <span className="font-dm text-[18px] font-semibold tracking-tight text-ink">ArkPay</span>
          </Link>

          <nav className="hidden items-center gap-8 md:flex">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                className="text-[14px] font-medium text-ink/70 transition-colors hover:text-ink"
              >
                {l.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <Link
              to="/login"
              className="hidden rounded-[10px] px-3 py-2 text-[14px] font-medium text-ink transition-colors hover:bg-newsprint sm:block"
            >
              Sign in
            </Link>
            <Link
              to="/overview"
              className="inline-flex items-center gap-1.5 rounded-[10px] bg-ink px-4 py-2 text-[14px] font-semibold text-paper transition-colors hover:bg-carbon"
            >
              Open the demo
            </Link>
            <button
              type="button"
              aria-label="Menu"
              onClick={() => setOpen((v) => !v)}
              className="grid h-9 w-9 place-items-center rounded-[10px] text-ink transition-colors hover:bg-newsprint md:hidden"
            >
              {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {open ? (
          <div className="border-t border-silver/70 bg-paper px-6 py-3 md:hidden">
            {LINKS.map((l) => (
              <a
                key={l.label}
                href={l.href}
                onClick={() => setOpen(false)}
                className="block py-2 text-[14px] font-medium text-ink"
              >
                {l.label}
              </a>
            ))}
            <Link to="/login" className="block py-2 text-[14px] font-medium text-graphite">
              Sign in
            </Link>
          </div>
        ) : null}
      </div>
    </header>
  );
}
