  import { cn } from "@/lib/utils";

  const DOT = {
    done: "bg-ink",
    current: "bg-ember",
    blocked: "bg-red-500",
    muted: "bg-mist",
  };

  export default function Timeline({ items = [], className }) {
    return (
      <ol className={cn("space-y-0", className)}>
        {items.map((item, i) => (
          <li key={`${item.title}-${i}`} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", DOT[item.state] ?? DOT.done)} />
              {i < items.length - 1 ? <span className="my-1 w-px flex-1 bg-mist/80" /> : null}
            </div>
            <div className="min-w-0 flex-1 pb-4">
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-[13px] font-medium text-ink">{item.title}</p>
                <span className="shrink-0 font-mono text-[10.5px] text-steel">{item.time}</span>
              </div>
              {item.detail ? <p className="mt-0.5 text-[11.5px] leading-4 text-pewter">{item.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    );
  }