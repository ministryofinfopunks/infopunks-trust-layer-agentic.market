"use client";

import { motion, useInView } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { motionDurations, motionEase } from "@/lib/motion/tokens";
import { cardReveal } from "@/lib/motion/variants";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";

export function CodeFrame({
  lines,
  highlight = [],
  activeLines = [],
  sweepLineIndex = null,
  className = ""
}) {
  const reducedMotion = useReducedMotionSafe();
  const frameRef = useRef(null);
  const isInView = useInView(frameRef, { once: true, amount: 0.35 });
  const [sweepActive, setSweepActive] = useState(false);
  const highlighted = activeLines.length > 0 ? activeLines : highlight;

  useEffect(() => {
    if (!isInView || reducedMotion || sweepLineIndex == null) {
      return undefined;
    }

    const startTimer = window.setTimeout(() => {
      setSweepActive(true);
    }, 400);
    const interval = window.setInterval(() => {
      setSweepActive((current) => !current);
      window.setTimeout(() => setSweepActive((current) => !current), 920);
    }, 9800);

    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(interval);
    };
  }, [isInView, reducedMotion, sweepLineIndex]);

  return (
    <motion.div
      ref={frameRef}
      className={`surface-card overflow-hidden ${className}`}
      variants={cardReveal({ reducedMotion })}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
    >
      <div className="flex items-center justify-between border-b border-white/5 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2f]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" />
        </div>
        <span className="mono-copy text-[11px] uppercase tracking-[0.24em] text-[var(--text-muted)]">trust-sdk</span>
      </div>
      <pre className="mono-copy overflow-x-auto px-4 py-4 text-[12px] leading-7 sm:px-6 sm:text-[13px]">
        {lines.map((line, index) => {
          const isHighlighted = highlighted.includes(index);
          const isSweepLine = sweepLineIndex === index;

          return (
            <motion.div
              key={`${line}-${index}`}
              layout
              className="relative rounded-lg px-3"
              animate={{
                backgroundColor: isHighlighted ? "rgba(0,255,159,0.08)" : "rgba(0,0,0,0)",
                color: isHighlighted ? "rgba(0,255,159,1)" : "rgba(255,255,255,0.68)"
              }}
              transition={{
                duration: motionDurations.standard,
                ease: motionEase.standard
              }}
            >
              {isSweepLine && sweepActive && !reducedMotion ? (
                <motion.span
                  aria-hidden="true"
                  className="absolute inset-y-1 left-0 w-1/3 rounded-full bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.12),transparent)]"
                  initial={{ x: "-120%", opacity: 0 }}
                  animate={{ x: "320%", opacity: [0, 0.6, 0] }}
                  transition={{ duration: 0.9, ease: motionEase.standard }}
                />
              ) : null}
              <span className="mr-4 inline-block w-4 select-none text-right text-[var(--text-muted)]">{index + 1}</span>
              <span>{line}</span>
            </motion.div>
          );
        })}
      </pre>
    </motion.div>
  );
}
