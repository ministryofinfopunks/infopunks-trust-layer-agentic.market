"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { motionDurations, motionEase } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";

export function ButtonLink({
  href,
  children,
  variant = "primary",
  className = "",
  showArrow = false,
  idlePulse = false
}) {
  const reducedMotion = useReducedMotionSafe();
  const isPrimary = variant === "primary";

  return (
    <motion.div
      className={`inline-flex ${className}`}
      initial={false}
      whileHover={
        reducedMotion
          ? undefined
          : {
              scale: isPrimary ? 1.015 : 1.01
            }
      }
      whileTap={reducedMotion ? undefined : { scale: 0.992 }}
      animate={
        idlePulse && !reducedMotion && isPrimary
          ? {
              boxShadow: [
                "0 0 0 rgba(0,255,159,0)",
                "0 0 24px rgba(0,255,159,0.08)",
                "0 0 0 rgba(0,255,159,0)"
              ]
            }
          : undefined
      }
      transition={
        idlePulse && !reducedMotion && isPrimary
          ? {
              duration: 6,
              ease: motionEase.standard,
              repeat: Number.POSITIVE_INFINITY,
              repeatDelay: 0.8
            }
          : {
              duration: motionDurations.fast,
              ease: motionEase.standard
            }
      }
    >
      <Link
        href={href}
        className={`${isPrimary ? "button-primary" : "button-secondary"} group relative overflow-hidden text-sm`}
      >
        <span className="relative z-10">{children}</span>
        {showArrow ? (
          <motion.span
            aria-hidden="true"
            className="relative z-10 inline-flex transition-transform duration-200 group-hover:translate-x-1"
            animate={idlePulse && !reducedMotion ? { x: [0, 0, 4, 0] } : undefined}
            transition={idlePulse && !reducedMotion ? { duration: 0.24, ease: motionEase.standard } : undefined}
          >
            →
          </motion.span>
        ) : null}
        {isPrimary ? (
          <motion.span
            aria-hidden="true"
            className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_center,_rgba(0,255,159,0.22),_transparent_68%)]"
            initial={{ opacity: 0.16 }}
            whileHover={reducedMotion ? undefined : { opacity: 0.3 }}
            transition={{ duration: motionDurations.fast, ease: motionEase.standard }}
          />
        ) : null}
      </Link>
    </motion.div>
  );
}
