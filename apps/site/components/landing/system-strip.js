"use client";

import { motion } from "motion/react";
import { Reveal, RevealGroup } from "@/components/motion/reveal";
import { fadeUp, hoverLift } from "@/lib/motion/variants";
import { motionDurations, motionEase } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";
import { systemFeatures } from "./mock-data";

export function SystemStrip() {
  const reducedMotion = useReducedMotionSafe();

  return (
    <section className="py-12 lg:py-16">
      <Reveal className="surface-card overflow-hidden p-4 sm:p-6" distance={12} duration={0.32}>
        <div className="flex flex-col gap-4 border-b border-white/6 pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <span className="section-label">What developers install</span>
            <h2 className="section-title mt-6 max-w-[760px]">Passport, Evidence, Trust, Routing, and Events in one developer flow.</h2>
          </div>
          <p className="section-copy max-w-[460px] text-sm">
            Keep the architecture elegant, but make the workflow explicit: register the agent, record what happened, resolve trust, route work, and subscribe to state changes.
          </p>
        </div>

        <RevealGroup className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-5" staggerChildren={0.04}>
          {systemFeatures.map((feature) => (
            <motion.article
              key={feature.id}
              variants={fadeUp({ distance: 10, duration: 0.22, reducedMotion })}
              initial="rest"
              whileHover={reducedMotion ? undefined : "hover"}
              animate="rest"
              className="surface-panel p-5"
            >
              <motion.div variants={hoverLift}>
                <motion.div
                  className="flex items-center gap-3"
                  variants={{
                    rest: { y: 0 },
                    hover: { y: -2, transition: { duration: motionDurations.fast, ease: motionEase.standard } }
                  }}
                >
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-[rgba(0,255,159,0.16)] bg-[rgba(0,255,159,0.08)] mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
                    {feature.index}
                  </span>
                  <p className="mono-copy text-[11px] uppercase tracking-[0.22em] text-[var(--accent)]">{feature.title}</p>
                </motion.div>
                <p className="mt-4 text-[15px] leading-7 text-[var(--text-secondary)]">{feature.blurb}</p>
                <p className="mono-copy mt-4 text-[11px] uppercase tracking-[0.18em] text-white">{feature.action}</p>
              </motion.div>
            </motion.article>
          ))}
        </RevealGroup>

        <div className="surface-panel mt-6 p-4">
          <div className="flow-rail">
            {systemFeatures.map((feature, index) => (
              <div key={feature.id} className="flex items-center gap-2">
                <span className="flow-token">{feature.action}</span>
                {index < systemFeatures.length - 1 ? <span className="text-[var(--text-muted)]">→</span> : null}
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </section>
  );
}
