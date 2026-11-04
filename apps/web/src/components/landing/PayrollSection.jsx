import Money from "@/components/arkay/Money";

const TEAM = [
  { name: "Tunde Bello", role: "Designer", amount: 1800 },
  { name: "Ngozi Eze", role: "Illustrator", amount: 1450 },
  { name: "Samuel Ade", role: "Dev", amount: 2200 },
  { name: "Halima Yusuf", role: "Ops", amount: 950 },
];

export default function PayrollSection() {
  return (
    <section className="border-b border-silver/60 bg-newsprint">
      <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-6 py-20 lg:grid-cols-2">
        <div>
          <h2 className="font-dm text-[32px] font-semibold leading-[1.12] tracking-tight text-ink sm:text-[40px]">
            Say “pay my team.” See the total. Tap once.
          </h2>
          <p className="mt-4 max-w-[460px] text-[15px] leading-[1.65] text-graphite">
            ArkPay assembles the batch from your saved contacts, pulls usual amounts from history, and flags anyone who
            looks off. Batch size and total caps apply before you ever see an approve button.
          </p>
          <ul className="mt-6 space-y-2 text-[13px] text-graphite">
            <li>· Every recipient and the total, always shown before approval</li>
            <li>· Monthly runs prepared automatically — never sent automatically</li>
            <li>· One idempotency key per batch, so a double tap pays no one twice</li>
          </ul>
        </div>

        <div className="rounded-[12px] border border-silver/60 bg-paper p-6 shadow-quo">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.14em] text-steel">November payroll</p>
              <Money amount={6400} className="mt-1 block font-dm text-[30px] font-semibold text-ink" />
              <p className="text-[12px] text-pewter">4 recipients · 64% of $10,000 batch cap</p>
            </div>
            <span className="rounded-md bg-newsprint px-2 py-1 text-[11px] font-medium text-graphite ring-1 ring-inset ring-silver/60">Prepared</span>
          </div>

          <div className="mt-5 divide-y divide-silver/50 border-y border-silver/50">
            {TEAM.map((t) => (
              <div key={t.name} className="flex items-center justify-between py-2.5">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-newsprint text-[10px] font-semibold text-graphite ring-1 ring-inset ring-silver/60">
                    {t.name.split(" ").map((p) => p[0]).join("")}
                  </span>
                  <div>
                    <p className="text-[13px] font-medium text-ink">{t.name}</p>
                    <p className="text-[11px] text-pewter">{t.role} · known contact</p>
                  </div>
                </div>
                <Money amount={t.amount} className="text-[13px] text-ink" />
              </div>
            ))}
          </div>

          <button className="mt-5 w-full rounded-[10px] bg-ink py-2.5 text-[13px] font-semibold text-paper transition-colors hover:bg-carbon">
            Approve batch of 4
          </button>
          <p className="mt-2 text-center text-[11px] text-pewter">Sandbox payouts · nothing is charged</p>
        </div>
      </div>
    </section>
  );
}
