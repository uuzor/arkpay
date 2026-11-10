import { Link } from "@tanstack/react-router";
import { useRouterState } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard,
  Inbox,
  ArrowDownLeft,
  ArrowUpRight,
  CalendarClock,
  ContactRound,
  ScrollText,
  Settings,
  LogOut,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/AuthContext";
import { approvalsQuery } from "@/lib/queries";

function initials(name) {
  return (name || "A")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

export default function SidebarNav({ open, onClose }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { logout, user, workspace } = useAuth();
  const { data: pending } = useQuery(approvalsQuery("PENDING_APPROVAL", 1));

  const nav = [
    { label: "Overview", to: "/overview", icon: LayoutDashboard },
    { label: "Inbox", to: "/inbox", icon: Inbox, badge: pending?.totalCount || null },
    { label: "Money in", to: "/money", icon: ArrowDownLeft },
    { label: "Payouts", to: "/payouts", icon: ArrowUpRight },
    { label: "Contacts", to: "/contacts", icon: ContactRound },
    { label: "Schedules", to: "/schedules", icon: CalendarClock },
    { label: "Activity", to: "/audit", icon: ScrollText },
    { label: "Settings", to: "/settings", icon: Settings },
  ];

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close menu"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-abyss/30 backdrop-blur-sm lg:hidden"
        />
      ) : null}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[232px] flex-col border-r border-mist/60 bg-paper transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between border-b border-mist/60 px-4">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-ink text-[11px] font-semibold text-paper">A</span>
            <span className="text-[15px] font-semibold tracking-[-0.03em] text-ink">Arkay</span>
          </Link>
          <button type="button" onClick={onClose} className="grid h-7 w-7 place-items-center rounded-lg text-steel lg:hidden">
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
          {nav.map((item) => {
            const active = pathname === item.to || pathname.startsWith(`${item.to}/`);
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={cn(
                  "group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors",
                  active ? "bg-fog font-medium text-ink" : "text-graphite hover:bg-fog/60 hover:text-ink",
                )}
              >
                {active ? <span className="absolute inset-y-1.5 left-0 w-[2px] rounded-full bg-ember" /> : null}
                <item.icon className={cn("h-4 w-4", active ? "text-ink" : "text-steel")} strokeWidth={1.9} />
                {item.label}
                {item.badge ? (
                  <span className="ml-auto rounded-md bg-ink px-1.5 py-px text-[10px] font-semibold text-paper tabular">
                    {item.badge}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-mist/60 p-3">
          <div className="rounded-lg bg-fog/70 px-2.5 py-2">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-paper text-[10.5px] font-semibold text-ink ring-1 ring-mist/70">
                {initials(user?.name || workspace?.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-ink">{user?.name || "Account"}</p>
                <p className="truncate text-[10.5px] text-pewter">{workspace?.name || user?.email || "Workspace"}</p>
              </div>
              <button
                type="button"
                onClick={() => logout()}
                aria-label="Sign out"
                className="ml-auto grid h-6 w-6 place-items-center rounded-md text-steel hover:bg-paper hover:text-ink"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
