"use client";

import { motion } from "motion/react";
import { ButtonLink } from "./button-link";
import { CodeFrame } from "./code-frame";
import { installSnippet, installSteps, trustResponseExample } from "./mock-data";
import { Reveal } from "@/components/motion/reveal";
import { cardReveal } from "@/lib/motion/variants";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";

export function InstallSection() {
  const reducedMotion = useReducedMotionSafe();

  return (
    <section className="grid gap-6 py-12 lg:grid-cols-[0.95fr_1.05fr] lg:py-16" id="install">
      <Reveal className="surface-card p-6 sm:p-8" distance={12} duration={0.32}>
        <span className="section-label">Install Trust In 5 Minutes</span>
        <div className="mt-8 space-y-6">
          <h2 className="section-title">Install trust in minutes</h2>
          <p className="section-copy-strong">
            SDK-first. API-backed. Event-driven. Install the package, resolve trust, and start changing routing decisions on the first pass through your agent loop.
          </p>
          <div className="surface-panel px-4 py-4">
            <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Run this first</p>
            <p className="mono-copy mt-3 text-[13px] leading-7 text-white sm:text-sm">npm install @infopunks/trust-sdk</p>
          </div>
          <div className="surface-panel px-4 py-4">
            <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">What happens next</p>
            <div className="mt-4 grid gap-3">
              {installSteps.map((step, index) => (
                <div key={step} className="flex items-start gap-3">
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[rgba(0,255,159,0.14)] bg-[rgba(0,255,159,0.08)] mono-copy text-[11px] uppercase tracking-[0.16em] text-[var(--accent)]">
                    {index + 1}
                  </span>
                  <p className="pt-1 text-sm leading-6 text-[var(--text-secondary)]">{step}</p>
                </div>
              ))}
            </div>
          </div>
          <motion.div
            className="surface-panel-strong p-5"
            variants={cardReveal({ reducedMotion })}
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.4 }}
          >
            <p className="mono-copy text-sm uppercase tracking-[0.18em] text-[var(--accent)]">First useful call</p>
            <p className="mono-copy mt-3 text-[13px] leading-7 text-white sm:text-sm">const trust = await ip.trust.resolve(...)</p>
            <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">This is the first return value you can immediately route with.</p>
          </motion.div>

          <ButtonLink href="#developers" className="w-full sm:w-auto" showArrow>
            Run Quickstart
          </ButtonLink>
        </div>
      </Reveal>

      <div className="grid gap-6">
        <CodeFrame lines={installSnippet} highlight={[15, 16]} sweepLineIndex={16} />
        <Reveal className="surface-card overflow-hidden p-4 sm:p-5" distance={12} duration={0.32} delay={0.05}>
          <div className="flex items-center justify-between gap-3 border-b border-white/6 pb-3">
            <p className="mono-copy text-[11px] uppercase tracking-[0.2em] text-[var(--accent)]">Example response</p>
            <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">route-ready</p>
          </div>
          <pre className="surface-panel mt-4 overflow-x-auto px-4 py-4 mono-copy text-[12px] leading-7 text-[var(--text-secondary)] sm:text-[13px]">
            {trustResponseExample.join("\n")}
          </pre>
        </Reveal>
      </div>
    </section>
  );
}
