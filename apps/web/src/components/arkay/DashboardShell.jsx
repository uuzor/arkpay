import { useEffect, useState } from "react";
import SidebarNav from "@/components/arkay/SidebarNav";
import TopBar from "@/components/arkay/TopBar";
import AgentBar from "@/components/arkay/ai/AgentBar";
import { cn } from "@/lib/utils";

export default function DashboardShell({ children }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === ".") {
        e.preventDefault();
        setAgentOpen((v) => !v);
      }
      if (e.key === "Escape") setAgentOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen bg-[#fafafb]">
      <SidebarNav open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div
        className={cn(
          "transition-[padding] duration-200 lg:pl-[232px]",
          agentOpen && "lg:pr-[360px]",
        )}
      >
        <TopBar
          onMenu={() => setMenuOpen(true)}
          agentOpen={agentOpen}
          onToggleAgent={() => setAgentOpen((v) => !v)}
        />
        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        <p className="mx-auto max-w-[1440px] px-4 pb-8 pt-2 text-[11px] text-steel sm:px-6 lg:px-8">
          Sandbox environment · live workspace data · no live PayPal money moves.
        </p>
      </div>

      <AgentBar open={agentOpen} onClose={() => setAgentOpen(false)} />
    </div>
  );
}