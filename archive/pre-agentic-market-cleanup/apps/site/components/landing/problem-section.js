"use client";

import { motion } from "motion/react";
import { Reveal, RevealGroup } from "@/components/motion/reveal";
import { motionDurations, motionEase } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";
import { networkEdges, networkNodes } from "./mock-data";

const problemPoints = [
  "Every agent system today has identity, messaging, and payments. None have trust.",
  "Hallucinating agents still get selected because the system has no live memory of failure.",
  "Validators end up validating each other in loops while capital keeps routing blindly.",
  "Silent failure is treated like success until the trace is already expensive."
];

export function ProblemSection() {
  const reducedMotion = useReducedMotionSafe();

  return (
    <section className="grid gap-6 py-12 lg:grid-cols-[1fr_1.05fr] lg:py-16">
      <Reveal className="surface-card p-6 sm:p-8" distance={12} duration={0.32}>
        <span className="section-label">Why trust has to exist first</span>
        <div className="mt-8 space-y-6">
          <h2 className="section-title">
            You do not have an intelligence problem.
            <br />
            You have a trust problem.
          </h2>
          <p className="section-copy-strong max-w-[620px]">
            Agent infrastructure can identify workers, move messages, and route money. It still cannot decide who should act after a failure.
          </p>
          <RevealGroup className="grid gap-4" staggerChildren={0.04}>
            {problemPoints.map((point) => (
              <motion.div
                key={point}
                variants={{
                  hidden: { opacity: 0, y: reducedMotion ? 0 : 12 },
                  show: {
                    opacity: 1,
                    y: 0,
                    transition: { duration: motionDurations.deliberate, ease: motionEase.standard }
                  }
                }}
                className="surface-panel px-4 py-4"
              >
                <p className="text-[15px] leading-7 text-[var(--text-secondary)]">{point}</p>
              </motion.div>
            ))}
          </RevealGroup>
        </div>
      </Reveal>

      <Reveal className="surface-card relative min-h-[420px] overflow-hidden p-6 sm:p-8" distance={12} duration={0.32} delay={0.04}>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_rgba(0,255,159,0.12),transparent_40%)]" />
        <div className="relative z-10 flex h-full flex-col">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="mono-copy text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">How trust changes routing</span>
              <h3 className="mt-3 text-[clamp(1.5rem,2.1vw,2rem)] leading-[1.02] text-white">Work should move because trust changed.</h3>
            </div>
            <div className="mono-copy rounded-full border border-[rgba(0,255,159,0.16)] bg-[rgba(0,255,159,0.08)] px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-[var(--accent)]">
              deterministic graph
            </div>
          </div>

          <div className="surface-panel relative mt-8 flex-1 overflow-hidden">
            <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              {networkEdges.map((edge) => (
                <motion.path
                  key={edge.id}
                  d={`M ${edge.from[0]} ${edge.from[1]} L ${edge.to[0]} ${edge.to[1]}`}
                  stroke={edge.hot ? "rgba(0,255,159,0.26)" : "rgba(255,255,255,0.14)"}
                  strokeWidth="0.55"
                  fill="none"
                  animate={
                    reducedMotion
                      ? undefined
                      : {
                          opacity: edge.hot ? [0.3, 0.7, 0.35] : [0.14, 0.22, 0.14]
                        }
                  }
                  transition={
                    reducedMotion
                      ? undefined
                      : {
                          duration: edge.hot ? 2.8 : 3.8,
                          ease: motionEase.linear,
                          repeat: Number.POSITIVE_INFINITY
                        }
                  }
                />
              ))}
              {!reducedMotion ? (
                <motion.circle
                  cx="48"
                  cy="44"
                  r="1.1"
                  fill="rgba(0,255,159,0.95)"
                  animate={{ cx: [48, 68, 48], cy: [44, 18, 44], opacity: [0, 1, 0] }}
                  transition={{ duration: 3.4, ease: motionEase.standard, repeat: Number.POSITIVE_INFINITY, repeatDelay: 1.2 }}
                />
              ) : null}
            </svg>

            {networkNodes.map((node) => (
              <motion.div
                key={node.id}
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-xl border px-4 py-3 ${
                  node.tone === "accent"
                    ? "border-[rgba(0,255,159,0.28)] bg-[rgba(0,255,159,0.1)] shadow-[0_0_36px_rgba(0,255,159,0.14)]"
                    : "border-white/8 bg-black/60"
                }`}
                style={{ left: `${node.x}%`, top: `${node.y}%` }}
                animate={
                  reducedMotion
                    ? undefined
                    : node.tone === "accent"
                      ? {
                          scale: [1, 1.02, 1],
                          boxShadow: [
                            "0 0 18px rgba(0,255,159,0.08)",
                            "0 0 32px rgba(0,255,159,0.16)",
                            "0 0 18px rgba(0,255,159,0.08)"
                          ]
                        }
                      : { scale: [1, 1.01, 1] }
                }
                transition={
                  reducedMotion
                    ? undefined
                    : {
                        duration: node.tone === "accent" ? 3.2 : 4,
                        ease: motionEase.standard,
                        repeat: Number.POSITIVE_INFINITY
                      }
                }
              >
                <p className={`mono-copy text-xs uppercase tracking-[0.2em] ${node.tone === "accent" ? "text-[var(--accent)]" : "text-[var(--text-secondary)]"}`}>
                  {node.id}
                </p>
              </motion.div>
            ))}

            <div className="surface-panel absolute bottom-5 left-5 max-w-[280px] px-4 py-4">
              <p className="mono-copy text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Observed failure</p>
              <p className="mt-2 text-sm leading-6 text-white">Agent_221 reversed a validator result after capital was already assigned.</p>
              <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                Without a trust layer, the graph stays static. With Infopunks, routing reacts before more tasks inherit the failure.
              </p>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
