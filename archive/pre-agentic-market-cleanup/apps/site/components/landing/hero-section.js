"use client";

import { AnimatePresence, motion } from "motion/react";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { ButtonLink } from "./button-link";
import { heroFeedSeed, heroInstallSummary, integrationTargets } from "./mock-data";
import { cardReveal, fadeUp, feedEntry, staggerContainer } from "@/lib/motion/variants";
import { motionDurations, motionEase } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";

function bandTone(band) {
  switch (band) {
    case "quarantined":
      return "text-[var(--danger)]";
    case "restricted":
      return "text-[var(--warning)]";
    case "preferred":
      return "text-[var(--accent)]";
    default:
      return "text-[var(--info)]";
  }
}

function statePulse(state) {
  if (state === "collapse") {
    return "rgba(255,93,115,0.18)";
  }

  if (state === "penalized") {
    return "rgba(255,200,87,0.16)";
  }

  return "rgba(0,255,159,0.16)";
}

export function HeroSection() {
  const reducedMotion = useReducedMotionSafe();
  const cursorRef = useRef(4);
  const timeoutRef = useRef(null);
  const [feed, setFeed] = useState(heroFeedSeed.slice(0, 5));

  const heroVariants = useMemo(
    () => staggerContainer({ delayChildren: 0.02, staggerChildren: 0.05, reducedMotion }),
    [reducedMotion]
  );

  useEffect(() => {
    function queueNext() {
      const delay = reducedMotion ? 2200 : 1400 + Math.round(Math.random() * 800);
      timeoutRef.current = window.setTimeout(() => {
        const nextEntry = heroFeedSeed[cursorRef.current % heroFeedSeed.length];
        cursorRef.current += 1;

        startTransition(() => {
          setFeed((current) => [{ ...nextEntry, streamId: `${nextEntry.id}_${cursorRef.current}` }, ...current].slice(0, 5));
        });

        queueNext();
      }, delay);
    }

    queueNext();

    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
      }
    };
  }, [reducedMotion]);

  return (
    <section className="relative pb-12 pt-6 sm:pb-16 sm:pt-10 lg:pb-24" id="top">
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute left-1/2 top-0 h-[420px] w-[420px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,_rgba(0,255,159,0.12),_transparent_70%)] blur-3xl"
        animate={
          reducedMotion
            ? undefined
            : {
                x: [-20, 18, -8],
                y: [0, 16, -10],
                opacity: [0.18, 0.24, 0.16],
                scale: [1, 1.04, 0.98]
              }
        }
        transition={
          reducedMotion
            ? undefined
            : {
                duration: 6,
                ease: motionEase.standard,
                repeat: Number.POSITIVE_INFINITY,
                repeatType: "mirror"
              }
        }
      />

      <motion.div className="mx-auto flex max-w-[960px] flex-col items-center text-center" variants={heroVariants} initial="hidden" animate="show">
        <motion.span variants={fadeUp({ distance: 8, duration: motionDurations.fast, reducedMotion })} className="section-label">
          Installable trust layer
        </motion.span>

        <div className="mt-8 space-y-6">
          <motion.p
            variants={fadeUp({ distance: 8, duration: motionDurations.fast, reducedMotion })}
            className="mono-copy text-sm uppercase tracking-[0.26em] text-[var(--text-muted)]"
          >
            SDK / API / event rail
          </motion.p>
          <motion.h1
            variants={fadeUp({ distance: 12, duration: motionDurations.standard, reducedMotion })}
            className="text-balance text-[48px] font-medium leading-[0.92] tracking-[-0.06em] text-white sm:text-[72px] lg:text-[104px]"
          >
            The Trust Layer for Agents
          </motion.h1>
          <motion.p
            variants={fadeUp({ distance: 10, duration: motionDurations.standard, reducedMotion })}
            className="mx-auto max-w-[780px] text-balance text-[18px] leading-8 text-[var(--text-secondary)] sm:text-[22px]"
          >
            SDK, API, and event rail for trust-aware agent routing.
          </motion.p>
          <motion.div
            variants={fadeUp({ distance: 10, duration: motionDurations.standard, reducedMotion })}
            className="surface-panel mx-auto max-w-[960px] px-4 py-4 text-left sm:px-5"
          >
            <p className="mono-copy text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">Proof line</p>
            <p className="mt-3 mono-copy text-[13px] leading-7 text-white sm:text-[14px]">
              Register identity <span className="text-[var(--text-muted)]">→</span> Record evidence{" "}
              <span className="text-[var(--text-muted)]">→</span> Resolve trust{" "}
              <span className="text-[var(--text-muted)]">→</span> Route work{" "}
              <span className="text-[var(--text-muted)]">→</span> Subscribe to live trust events
            </p>
          </motion.div>
        </div>

        <motion.div variants={fadeUp({ distance: 8, duration: 0.22, reducedMotion })} className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
          <ButtonLink href="#install" className="min-w-[240px]">
            Install in 5 minutes
          </ButtonLink>
          <ButtonLink href="#proof" variant="secondary" className="min-w-[220px]">
            Watch live trust break
          </ButtonLink>
        </motion.div>

        <motion.div variants={cardReveal({ reducedMotion })} className="surface-card mt-8 w-full max-w-[920px] overflow-hidden p-4 sm:p-6">
          <div className="surface-panel px-4 py-3 text-left">
            <p className="mono-copy text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">Install surface</p>
            <p className="mt-2 mono-copy text-[13px] leading-7 text-white">npm install @infopunks/trust-sdk</p>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="surface-panel p-4 text-left">
              <p className="mono-copy text-[11px] uppercase tracking-[0.2em] text-[var(--accent)]">You install</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {heroInstallSummary.install.map((item) => (
                  <span key={item} className="flow-token">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            <div className="surface-panel-strong p-4 text-left">
              <p className="mono-copy text-[11px] uppercase tracking-[0.2em] text-[var(--accent)]">You get</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {heroInstallSummary.get.map((item) => (
                  <span key={item} className="flow-token flow-token-accent">
                    {item}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="surface-panel mt-4 px-4 py-4 text-left">
            <p className="mono-copy text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)]">Works with</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {integrationTargets.map((item) => (
                <span key={item} className="flow-token">
                  {item}
                </span>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.div
          variants={cardReveal({ reducedMotion })}
          className="surface-card-strong line-glow mt-10 w-full max-w-[880px] overflow-hidden p-4 sm:p-6"
        >
          <div className="flex flex-col gap-4 border-b border-[rgba(0,255,159,0.12)] pb-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="text-left">
              <p className="mono-copy text-xs uppercase tracking-[0.24em] text-[var(--accent)]">Live trust feed</p>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                Trust changes routing decisions as soon as evidence lands. This is what your agent loop sees next.
              </p>
            </div>
            <div className="mono-copy text-left text-[11px] uppercase tracking-[0.2em] text-[var(--text-muted)] sm:text-right">
              update cadence: 1.4–2.2s
            </div>
          </div>

          <motion.div layout className="mt-4 grid gap-3">
            <AnimatePresence initial={false}>
              {feed.map((item, index) => (
                <motion.article
                  key={item.streamId ?? item.id}
                  layout
                  variants={feedEntry}
                  initial="hidden"
                  animate="show"
                  exit="exit"
                  className="relative overflow-hidden rounded-xl border border-white/6 bg-white/[0.02] px-4 py-4 text-left sm:grid sm:grid-cols-[1.1fr_0.7fr_1.4fr] sm:gap-3"
                  style={{ opacity: index === 0 ? 1 : 0.65 + Math.max(0, 0.18 - index * 0.03) }}
                >
                  <motion.div
                    aria-hidden="true"
                    className="absolute inset-0"
                    initial={reducedMotion ? { opacity: 0.08 } : { opacity: 0 }}
                    animate={reducedMotion ? undefined : { opacity: [0, 0.7, 0] }}
                    transition={{ duration: item.state === "collapse" ? 0.5 : 0.7, ease: motionEase.standard }}
                    style={{ background: `linear-gradient(90deg, ${statePulse(item.state)}, transparent 65%)` }}
                  />
                  {item.state === "collapse" ? (
                    <motion.span
                      aria-hidden="true"
                      className="absolute inset-y-0 left-0 w-px bg-[var(--danger)]"
                      initial={reducedMotion ? { scaleY: 1, opacity: 1 } : { scaleY: 0, opacity: 0.4 }}
                      animate={{ scaleY: 1, opacity: 1 }}
                      transition={{ duration: 0.18, ease: motionEase.standard }}
                      style={{ originY: 0 }}
                    />
                  ) : null}
                  <div className="relative">
                    <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Subject</p>
                    <p className="mt-2 mono-copy text-sm text-white">{item.agent}</p>
                  </div>
                  <div className="relative mt-4 sm:mt-0">
                    <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Trust delta</p>
                    <p className={`mt-2 mono-copy text-sm ${item.change < 0 ? "text-[var(--danger)]" : "text-[var(--accent)]"}`}>
                      {item.change > 0 ? `+${item.change}` : item.change}
                    </p>
                  </div>
                  <div className="relative mt-4 sm:mt-0 sm:text-right">
                    <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">{item.label}</p>
                    <p className={`mt-2 mono-copy text-sm uppercase tracking-[0.18em] ${bandTone(item.band)}`}>{item.band}</p>
                    <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{item.detail}</p>
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}
