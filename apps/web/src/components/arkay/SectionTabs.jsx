import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

/**
 * Section tab bar for merged pages (Inbox, Money in, Settings). Tabs are
 * Links carrying ?tab= so every tab is deep-linkable and survives reload.
 */
export default function SectionTabs({ to, tabs, active }) {
  return (
    <div className="flex flex-wrap gap-1">
      {tabs.map((t) => (
        <Link
          key={t.value}
          to={to}
          search={{ tab: t.value }}
          className={cn(
            "rounded-lg px-3 py-1.5 text-[12.5px] font-medium transition-colors",
            active === t.value
              ? "bg-ink text-paper"
              : "bg-paper text-graphite ring-1 ring-inset ring-mist/70 hover:text-ink",
          )}
        >
          {t.label}
          {typeof t.count === "number" ? (
            <span className={cn("ml-1.5 tabular", active === t.value ? "text-paper/70" : "text-steel")}>
              {t.count}
            </span>
          ) : null}
        </Link>
      ))}
    </div>
  );
}
