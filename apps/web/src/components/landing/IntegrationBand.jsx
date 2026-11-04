const STATS = [
  { value: "20/20", label: "extraction fixtures pass" },
  { value: "25/25", label: "safety policy tests pass" },
  { value: "6/6", label: "agent chat scenarios pass" },
  { value: "live", label: "PayPal sandbox invoices" },
  { value: "$0", label: "live money moved" },
];

export default function IntegrationBand() {
  return (
    <section className="border-b border-silver/60 bg-newsprint">
      <div className="mx-auto max-w-[1200px] px-6 py-10">
        <p className="text-center text-[12px] font-medium uppercase tracking-[0.16em] text-steel">
          Live on the PayPal sandbox — every number below is a real test score
        </p>
        <div className="mt-6 grid grid-cols-2 items-center justify-items-center gap-x-6 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          {STATS.map((s) => (
            <div key={s.label} className="text-center">
              <p className="font-dm text-[26px] font-semibold tracking-tight text-ink tabular">{s.value}</p>
              <p className="mt-0.5 text-[12px] text-pewter">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
