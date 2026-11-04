import { Menu, ChevronDown, Circle, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";

function initials(name) {
  return (name || "A")
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 2);
}

export default function TopBar({ onMenu, agentOpen, onToggleAgent }) {
  const { user, workspace } = useAuth();
  return (
    <div className="sticky top-0 z-30 border-b border-mist/60 bg-paper/90 backdrop-blur-xl">
      <div className="flex h-14 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={onMenu}
          aria-label="Open menu"
          className="grid h-8 w-8 place-items-center rounded-lg text-ink hover:bg-fog lg:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="hidden items-center gap-1.5 text-[12px] text-pewter sm:flex">
          <span className="font-medium text-ink">{workspace?.name ?? "Workspace"}</span>
          <span className="text-mist">/</span>
          <span>{workspace?.gmailAddress || user?.email || "Connected workspace"}</span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleAgent}
            aria-label="Toggle agent panel"
            aria-pressed={agentOpen}
            title="Agent (⌘.)"
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] font-medium transition-colors ${
              agentOpen
                ? "border-ink/30 bg-fog text-ink"
                : "border-mist/80 text-graphite hover:border-ink/30 hover:text-ink"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" /> Agent
          </button>

          <div className="relative">
            <select
              defaultValue={workspace?.paypalMode ?? "sandbox"}
              aria-label="Environment"
              className="h-8 cursor-pointer appearance-none rounded-lg border border-mist/80 bg-paper pl-2.5 pr-7 text-[12px] font-medium text-ink outline-none"
            >
              <option value="sandbox">Sandbox</option>
              <option value="live" disabled>Live (off)</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-steel" />
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-lg border border-mist/80 px-2 py-1 text-[11.5px] font-medium text-ink">
            <Circle className="h-2 w-2 animate-pulse fill-emerald-500 text-emerald-500" />
            Agent live
          </span>

          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-[10.5px] font-semibold text-paper">
            {initials(workspace?.name || user?.name)}
          </span>
        </div>
      </div>
    </div>
  );
}
