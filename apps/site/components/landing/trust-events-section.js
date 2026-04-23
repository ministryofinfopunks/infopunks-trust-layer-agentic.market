"use client";

import { motion } from "motion/react";
import { useEffect, useState } from "react";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { Reveal, RevealGroup } from "@/components/motion/reveal";
import { fadeUp, hoverLift } from "@/lib/motion/variants";
import { motionDurations, motionEase } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";
import { trustEventCards } from "./mock-data";

function EventCard({ card, index, activeIndex, reducedMotion }) {
  const isActive = index === activeIndex;

  return (
    <motion.article
      variants={fadeUp({ distance: 12, duration: 0.26, reducedMotion })}
      initial="rest"
      whileHover={reducedMotion ? undefined : "hover"}
      animate="rest"
      className={`surface-panel relative min-w-[300px] flex-1 snap-start overflow-hidden p-5 transition-colors duration-300 sm:min-w-[340px] ${
        isActive ? "border-[rgba(0,255,159,0.24)] bg-[rgba(0,255,159,0.05)]" : ""
      }`}
    >
      <motion.div variants={hoverLift}>
        <div className="flex items-center justify-between gap-3">
          <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">{card.title}</p>
          <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{card.timestamp}</p>
        </div>

        {card.type === "collapse" ? (
          <div className="relative mt-6 space-y-4">
            {isActive && !reducedMotion ? (
              <motion.div
                aria-hidden="true"
                className="absolute left-0 top-8 h-16 w-16 rounded-full bg-[radial-gradient(circle,_rgba(255,93,115,0.22),_transparent_68%)]"
                animate={{ scale: [0.92, 1.08, 1], opacity: [0, 0.28, 0] }}
                transition={{ duration: 0.58, ease: motionEase.standard }}
              />
            ) : null}
            <div>
              <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Subject</p>
              <p className="mt-2 text-xl text-white">{card.agent}</p>
            </div>
            <div>
              <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Score</p>
              <div className="mt-2 flex items-end gap-3">
                <AnimatedNumber value={card.scoreTo} className="text-4xl font-medium tracking-[-0.04em] text-white" />
                <motion.span
                  className="mono-copy rounded-full border border-[rgba(255,93,115,0.18)] bg-[rgba(255,93,115,0.08)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[var(--danger)]"
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.6 }}
                  transition={{ delay: 0.08, duration: motionDurations.fast, ease: motionEase.standard }}
                >
                  {card.delta}
                </motion.span>
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">from {card.scoreFrom} after validator reversal</p>
            </div>
            <p className="text-base leading-7 text-[var(--text-secondary)]">{card.summary}</p>
          </div>
        ) : null}

        {card.type === "reroute" ? (
          <div className="mt-6 space-y-4">
            <div>
              <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Route</p>
              <div className="mt-2 flex items-center gap-2 text-xl text-white">
                <span>{card.routeFrom}</span>
                <motion.span
                  aria-hidden="true"
                  animate={isActive && !reducedMotion ? { x: [0, 6, 0] } : undefined}
                  transition={isActive && !reducedMotion ? { duration: 0.7, ease: motionEase.standard, repeat: Number.POSITIVE_INFINITY, repeatDelay: 0.6 } : undefined}
                >
                  →
                </motion.span>
                <span className="text-[var(--accent)]">{card.routeTo}</span>
              </div>
            </div>
            <div className="space-y-2">
              {card.details.map((detail, detailIndex) => (
                <motion.p
                  key={detail}
                  initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, amount: 0.6 }}
                  transition={{ delay: 0.05 * detailIndex, duration: motionDurations.fast, ease: motionEase.standard }}
                  className="mono-copy text-[12px] uppercase tracking-[0.18em] text-[var(--text-secondary)]"
                >
                  {detail}
                </motion.p>
              ))}
            </div>
            <p className="text-base leading-7 text-[var(--text-secondary)]">{card.summary}</p>
          </div>
        ) : null}

        {card.type === "reject" ? (
          <div className="mt-6 space-y-4">
            <div>
              <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Validator</p>
              <p className="mt-2 text-xl text-white">{card.agent}</p>
            </div>
            <motion.div
              initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.6 }}
              transition={{ duration: motionDurations.fast, delay: 0.18, ease: motionEase.standard }}
              className="inline-flex rounded-full border border-[rgba(255,200,87,0.18)] bg-[rgba(255,200,87,0.08)] px-3 py-1 mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--warning)]"
            >
              {card.chip}
            </motion.div>
            <p className="text-base leading-7 text-[var(--text-secondary)]">{card.summary}</p>
          </div>
        ) : null}
      </motion.div>
    </motion.article>
  );
}

export function TrustEventsSection() {
  const reducedMotion = useReducedMotionSafe();
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % trustEventCards.length);
    }, 2200);

    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  return (
    <section className="py-12 lg:py-16" id="proof">
      <Reveal className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between" distance={12} duration={0.32}>
        <div>
          <span className="section-label">What trust changes</span>
          <h2 className="section-title mt-6 max-w-[760px]">This is not a score. This is a reacting system.</h2>
        </div>
        <p className="section-copy max-w-[440px] text-base">
          Agent_221 lost 35 trust points on a validator reversal. The system quarantined the subject and rerouted three tasks without waiting for an operator.
        </p>
      </Reveal>

      <RevealGroup className="mt-8 flex snap-x gap-4 overflow-x-auto pb-2" staggerChildren={0.06}>
        {trustEventCards.map((card, index) => (
          <EventCard key={card.id} card={card} index={index} activeIndex={activeIndex} reducedMotion={reducedMotion} />
        ))}
      </RevealGroup>
    </section>
  );
}
