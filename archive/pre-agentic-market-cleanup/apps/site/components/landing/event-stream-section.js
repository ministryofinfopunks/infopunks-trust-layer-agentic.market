"use client";

import { AnimatePresence, motion } from "motion/react";
import { startTransition, useEffect, useRef, useState } from "react";
import { Reveal } from "@/components/motion/reveal";
import { logEntry } from "@/lib/motion/variants";
import { motionDurations, motionEase } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";
import { eventLogSeed } from "./mock-data";

function accentStyle(type) {
  if (type === "trust.spike") {
    return {
      marker: "bg-[var(--accent)]",
      flash: "rgba(0,255,159,0.12)"
    };
  }

  if (type === "trust.collapse") {
    return {
      marker: "bg-[var(--danger)]",
      flash: "rgba(255,93,115,0.12)"
    };
  }

  if (type === "quarantine.enforced") {
    return {
      marker: "bg-[var(--warning)]",
      flash: "rgba(255,200,87,0.1)"
    };
  }

  return {
    marker: "bg-white/25",
    flash: "rgba(255,255,255,0.06)"
  };
}

export function EventStreamSection() {
  const reducedMotion = useReducedMotionSafe();
  const cursorRef = useRef(5);
  const timeoutRef = useRef(null);
  const [lines, setLines] = useState(eventLogSeed.slice(0, 5));

  useEffect(() => {
    function queueNext() {
      const delay = reducedMotion ? 1800 : 1200 + Math.round(Math.random() * 600);
      timeoutRef.current = window.setTimeout(() => {
        const nextLine = eventLogSeed[cursorRef.current % eventLogSeed.length];
        cursorRef.current += 1;

        startTransition(() => {
          setLines((current) => [{ ...nextLine, streamId: `${nextLine.id}_${cursorRef.current}` }, ...current].slice(0, 7));
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
    <section className="py-12 lg:py-16">
      <Reveal className="surface-card overflow-hidden" id="events" distance={12} duration={0.32}>
        <div className="flex flex-col gap-4 border-b border-white/6 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-6">
          <div>
            <span className="section-label">Live event rail</span>
            <h2 className="section-title mt-6 max-w-[620px]">Trust is a live signal</h2>
          </div>
          <p className="section-copy max-w-[460px] text-sm">
            Watch trust move in real time. Replayable events drive quarantine, validator selection, and rerouting as soon as the graph changes.
          </p>
        </div>

        <div className="bg-[linear-gradient(180deg,rgba(0,255,159,0.06),transparent_22%)] px-5 py-6 sm:px-6">
          <div className="surface-panel bg-[var(--surface-strong)] px-4 py-4 sm:px-5">
            <div className="mono-copy flex flex-wrap items-center gap-3 border-b border-white/6 pb-3 text-[11px] uppercase tracking-[0.22em] text-[var(--text-muted)]">
              <span>event stream</span>
              <span className="inline-flex items-center gap-2 text-[var(--accent)]">
                <span className="h-2 w-2 rounded-full bg-[var(--accent)] shadow-[0_0_14px_rgba(0,255,159,0.8)]" />
                live
              </span>
              <motion.span
                aria-hidden="true"
                className="ml-auto inline-flex h-4 w-2 rounded-full bg-[var(--accent)]"
                animate={reducedMotion ? undefined : { opacity: [1, 0.18, 1] }}
                transition={reducedMotion ? undefined : { duration: 0.9, ease: motionEase.linear, repeat: Number.POSITIVE_INFINITY }}
              />
            </div>

            <motion.div layout className="mt-4 grid gap-3">
              <AnimatePresence initial={false}>
                {lines.map((line, index) => {
                  const accent = accentStyle(line.type);

                  return (
                    <motion.div
                      key={line.streamId ?? line.id}
                      layout
                      variants={logEntry}
                      initial="hidden"
                      animate="show"
                    exit="exit"
                      className="surface-panel relative overflow-hidden px-3 py-3"
                      style={{ opacity: index === 0 ? 1 : 0.68 + Math.max(0, 0.16 - index * 0.02) }}
                    >
                      <motion.span
                        aria-hidden="true"
                        className={`absolute inset-y-0 left-0 w-px ${accent.marker}`}
                        initial={{ opacity: 0.28, scaleY: reducedMotion ? 1 : 0.25 }}
                        animate={{ opacity: 1, scaleY: 1 }}
                        transition={{ duration: line.type === "trust.collapse" ? 0.18 : motionDurations.fast, ease: motionEase.standard }}
                        style={{ transformOrigin: "top" }}
                      />
                      {!reducedMotion ? (
                        <motion.span
                          aria-hidden="true"
                          className="absolute inset-0"
                          initial={{ opacity: 0 }}
                          animate={
                            line.type === "route.changed"
                              ? { x: ["-20%", "110%"], opacity: [0, 0.5, 0] }
                              : { opacity: [0, 0.7, 0] }
                          }
                          transition={{
                            duration: line.type === "route.changed" ? 0.36 : 0.3,
                            ease: motionEase.standard
                          }}
                          style={{
                            background:
                              line.type === "route.changed"
                                ? "linear-gradient(90deg, transparent, rgba(255,255,255,0.08), transparent)"
                                : `linear-gradient(90deg, ${accent.flash}, transparent 65%)`
                          }}
                        />
                      ) : null}
                      <div className="relative flex items-start gap-3">
                        {line.type === "quarantine.enforced" ? (
                          <motion.span
                            initial={{ opacity: 0, scale: reducedMotion ? 1 : 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: motionDurations.fast, ease: motionEase.standard }}
                            className="mt-0.5 inline-flex text-[var(--warning)]"
                            aria-hidden="true"
                          >
                            ⌁
                          </motion.span>
                        ) : null}
                        <code className="mono-copy block text-[12px] leading-6 text-[var(--text-secondary)] sm:text-[13px]">{line.text}</code>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </motion.div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
