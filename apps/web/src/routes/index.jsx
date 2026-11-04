import { createFileRoute } from "@tanstack/react-router";
import SiteNav from "@/components/landing/SiteNav";
import Hero from "@/components/landing/Hero";
import IntegrationBand from "@/components/landing/IntegrationBand";
import ProblemSection from "@/components/landing/ProblemSection";
import HowItWorks from "@/components/landing/HowItWorks";
import ControlRoomSection from "@/components/landing/ControlRoomSection";
import SafetySection from "@/components/landing/SafetySection";
import PayrollSection from "@/components/landing/PayrollSection";
import PricingSection from "@/components/landing/PricingSection";
import ClosingCTA from "@/components/landing/ClosingCTA";
import SiteFooter from "@/components/landing/SiteFooter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ArkPay — the payments agent with a safety engine" },
      {
        name: "description",
        content:
          "ArkPay is the payments agent with a safety engine, for businesses and freelancers: it reads a money request from email or chat, drafts the PayPal invoice or payout, and waits for one approval before executing — with policy caps, risk checks, idempotency, and a full audit trail.",
      },
    ],
  }),
  component: LandingPage,
});

function LandingPage() {
  return (
    <div className="min-h-screen bg-paper">
      <SiteNav />
      <main>
        <Hero />
        <IntegrationBand />
        <ProblemSection />
        <HowItWorks />
        <ControlRoomSection />
        <SafetySection />
        <PayrollSection />
        <PricingSection />
        <ClosingCTA />
      </main>
      <SiteFooter />
    </div>
  );
}