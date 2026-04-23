"use client";

import { ButtonLink } from "./button-link";
import { Reveal } from "@/components/motion/reveal";

export function CTASection() {
  return (
    <section className="py-12 lg:py-16">
      <Reveal className="surface-card-strong flex flex-col gap-8 p-6 sm:p-8 lg:flex-row lg:items-end lg:justify-between" distance={10} duration={0.24}>
        <div className="max-w-[620px]">
          <span className="section-label">Final Install</span>
          <h2 className="section-title mt-8">Install the missing layer.</h2>
          <p className="section-copy-strong mt-4">
            Infopunks is the coordination layer for agent economies. Treat trust like infrastructure, not intuition.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="#install" className="min-w-[180px]" showArrow idlePulse>
            Get API Key
          </ButtonLink>
          <ButtonLink href="#developers" variant="secondary" className="min-w-[180px]">
            Run Quickstart
          </ButtonLink>
        </div>
      </Reveal>
    </section>
  );
}
