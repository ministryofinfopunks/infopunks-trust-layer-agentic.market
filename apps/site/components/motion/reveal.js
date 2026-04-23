"use client";

import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";
import { fadeUp, staggerContainer } from "@/lib/motion/variants";
import { motionDistances, motionDurations } from "@/lib/motion/tokens";

export function Reveal({
  as = "div",
  className = "",
  children,
  distance = motionDistances.md,
  duration = motionDurations.deliberate,
  delay = 0,
  once = true,
  amount = 0.25
}) {
  const reducedMotion = useReducedMotionSafe();
  const Component = motion[as] || motion.div;

  return (
    <Component
      className={className}
      variants={fadeUp({ distance, duration, delay, reducedMotion })}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
    >
      {children}
    </Component>
  );
}

export function RevealGroup({
  as = "div",
  className = "",
  children,
  delayChildren = 0,
  staggerChildren = 0.05,
  once = true,
  amount = 0.2
}) {
  const reducedMotion = useReducedMotionSafe();
  const Component = motion[as] || motion.div;

  return (
    <Component
      className={className}
      variants={staggerContainer({ delayChildren, staggerChildren, reducedMotion })}
      initial="hidden"
      whileInView="show"
      viewport={{ once, amount }}
    >
      {children}
    </Component>
  );
}
