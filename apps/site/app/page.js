import { CTASection } from "@/components/landing/cta-section";
import { EventStreamSection } from "@/components/landing/event-stream-section";
import { FearSection } from "@/components/landing/fear-section";
import { Footer } from "@/components/landing/footer";
import { HeroSection } from "@/components/landing/hero-section";
import { InstallSection } from "@/components/landing/install-section";
import { Navbar } from "@/components/landing/navbar";
import { ProblemSection } from "@/components/landing/problem-section";
import { SystemStrip } from "@/components/landing/system-strip";
import { TrustEventsSection } from "@/components/landing/trust-events-section";
import { UsageSection } from "@/components/landing/usage-section";

export default function Page() {
  return (
    <main className="relative min-h-screen overflow-x-clip bg-[var(--bg)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(0,255,159,0.11),_transparent_0,_transparent_38%),radial-gradient(circle_at_bottom_right,_rgba(0,255,159,0.08),_transparent_0,_transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(255,255,255,0.02)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.02)_1px,transparent_1px)] [background-size:64px_64px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[1280px] flex-col px-4 pb-16 pt-4 sm:px-6 lg:px-10">
        <Navbar />
        <HeroSection />
        <InstallSection />
        <SystemStrip />
        <ProblemSection />
        <TrustEventsSection />
        <UsageSection />
        <EventStreamSection />
        <FearSection />
        <CTASection />
        <Footer />
      </div>
    </main>
  );
}
