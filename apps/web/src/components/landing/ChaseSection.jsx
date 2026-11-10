import Money from "@/components/arkay/Money";

const OVERDUE = [
  { id: "INV2-0081", client: "Lagos Print Co", days: 14, amount: 450 },
  { id: "INV2-0079", client: "Kemi Beauty", days: 9, amount: 1200 },
  { id: "INV2-0074", client: "Northside Café", days: 6, amount: 300 },
];

export default function ChaseSection() {
  return (
    <section className="border-b border-silver/60 bg-newsprint">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 py-20 lg:grid-cols-2">
        <div>
          <h2 className="font-dm text-[32px] font-semibold leading-[1.12] tracking-tight text-ink sm:text-[40px]">
            The chase sends itself. You just get paid.
          </h2>
          <p className="mt-4 max-w-[460px] text-[15px] leading-[1.65] text-graphite">
            ArkPay watches every SENT invoice through PayPal webhooks. When one goes quiet past its due
            date, it drafts the reminder in your tone and sends it after your tap — then tells you the
            moment the money lands.
          </p>
          <ul className="mt-6 space-y-2 text-[13px] text-graphite">
            <li>· Overdue invoices surface on their own — no spreadsheet to check</li>
            <li>· Polite first, firmer later — the tone escalates with the delay</li>
            <li>· Every reminder and every payment lands in the same audit trail</li>
          </ul>
        </div>

        <div className="rounded-[12px] border border-silver/60 bg-paper p-6 shadow-quo">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-steel">Overdue this week</p>
              <Money amount={1950} className="mt-1 block font-dm text-[30px] font-semibold text-ink" />
              <p className="text-[12px] text-pewter">3 invoices · 2 reminders sent</p>
            </div>
            <span className="rounded-md bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">Chasing</span>
          </div>

          <div className="mt-5 divide-y divide-silver/50 border-y border-silver/50">
            {OVERDUE.map((o) => (
              <div key={o.id} className="flex items-center justify-between py-2.5">
                <div>
                  <p className="text-[13px] font-medium text-ink">{o.client}</p>
                  <p className="font-mono text-[10.5px] text-steel">
                    {o.id} · {o.days} days overdue
                  </p>
                </div>
                <Money amount={o.amount} className="text-[13px] text-ink" />
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-[10px] bg-newsprint px-3.5 py-3 ring-1 ring-inset ring-silver/60">
            <p className="text-[11px] uppercase tracking-[0.14em] text-steel">Next reminder · your tone</p>
            <p className="mt-1.5 text-[13px] leading-[1.6] text-graphite">
              “Hi Ada — just floating INV2-0081 ($450) back to the top of your inbox. Let me know if you
              need anything from me to close it out.”
            </p>
          </div>
          <p className="mt-2 text-center text-[11px] text-pewter">Sandbox invoices · nothing is charged</p>
        </div>
      </div>
    </section>
  );
}
