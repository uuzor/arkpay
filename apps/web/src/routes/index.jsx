import { createFileRoute } from "@tanstack/react-router";
import SiteNav from "@/components/landing/SiteNav";
import Hero from "@/components/landing/Hero";
import IntegrationBand from "@/components/landing/IntegrationBand";
import ProblemSection from "@/components/landing/ProblemSection";
import HowItWorks from "@/components/landing/HowItWorks";
import ControlRoomSection from "@/components/landing/ControlRoomSection";
import SafetySection from "@/components/landing/SafetySection";
import ChaseSection from "@/components/landing/ChaseSection";
import PricingSection from "@/components/landing/PricingSection";
import ClosingCTA from "@/components/landing/ClosingCTA";
import SiteFooter from "@/components/landing/SiteFooter";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ArkPay — get paid without the paperwork" },
      {
        name: "description",
        content:
          "ArkPay is the pocket finance office for freelancers: client emails become PayPal invoices with one phone tap, late payers get chased automatically, and disputes get drafted defenses — every step guarded by a safety engine with a full audit trail.",
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
        <ChaseSection />
        <PricingSection />
        <ClosingCTA />
      </main>
      <SiteFooter />
    </div>
  );
}