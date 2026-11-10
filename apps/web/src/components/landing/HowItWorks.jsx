const STEPS = [
  {
    n: "01",
    title: "Listens",
    body: "Connects to your inbox and reads every new message. Written by a stranger, treated as untrusted data.",
  },
  {
    n: "02",
    title: "Understands",
    body: "Classifies the ask — a client needing an invoice, money you owe, or noise — and extracts payee, amount, currency, purpose and due date.",
  },
  {
    n: "03",
    title: "Asks you",
    body: "One card in Telegram: payee, PayPal email, amount, purpose and the source snippet. Approve, edit, or ignore.",
  },
  {
    n: "04",
    title: "Collects",
    body: "Sends the PayPal invoice, then tracks it through webhooks — chasing it when late and drafting your defense if it's disputed.",
  },
];

export default function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-24 border-b border-silver/60 bg-paper">
      <div className="mx-auto max-w-[1200px] px-6 py-20">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-[560px]">
            <h2 className="font-dm text-[32px] font-semibold leading-[1.12] tracking-tight text-ink sm:text-[40px]">
              One approval. Between the email and the money.
            </h2>
          </div>
          <p className="max-w-[300px] text-[13px] leading-[1.6] text-pewter">
            The model proposes, code disposes. Extraction is a fixed JSON schema — building the payment action is
            deterministic, validated code.
          </p>
        </div>

        <div className="mt-12 grid gap-px border-t border-silver/60 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <div key={s.n} className="border-b border-silver/60 py-7 pr-6 sm:border-b-0 sm:border-l sm:border-silver/60 sm:pl-6 sm:first:border-l-0 sm:first:pl-0">
              <span className="rounded-md bg-ink px-2 py-0.5 font-mono text-[11px] font-medium text-paper">{s.n}</span>
              <h3 className="mt-3 font-dm text-[20px] font-semibold tracking-tight text-ink">{s.title}</h3>
              <p className="mt-2 text-[14px] leading-[1.6] text-graphite">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
