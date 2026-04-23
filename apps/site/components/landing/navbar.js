"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { ButtonLink } from "./button-link";
import { fadeUp, staggerContainer } from "@/lib/motion/variants";
import { motionDurations } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";

const navItems = [
  { label: "Docs", href: "#install" },
  { label: "GitHub", href: "#developers" },
  { label: "War Room", href: "/war-room" }
];

export function Navbar() {
  const reducedMotion = useReducedMotionSafe();

  return (
    <motion.header
      className="sticky top-4 z-40 mb-12"
      variants={fadeUp({ distance: 12, duration: motionDurations.standard, reducedMotion })}
      initial="hidden"
      animate="show"
    >
      <motion.nav
        className="surface-card mx-auto flex min-h-16 items-center justify-between gap-4 px-4 py-3 backdrop-blur sm:px-6"
        variants={staggerContainer({ delayChildren: 0.03, staggerChildren: 0.03, reducedMotion })}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={fadeUp({ distance: 8, duration: motionDurations.fast, reducedMotion })}>
          <Link href="/" className="flex items-center gap-3">
            <span className="mono-copy text-[13px] uppercase tracking-[0.32em] text-[var(--accent)]">INFOPUNKS</span>
            <span className="hidden h-4 w-px bg-white/10 sm:block" />
            <span className="hidden text-sm text-[var(--text-muted)] sm:block">Trust Score™</span>
          </Link>
        </motion.div>

        <div className="flex items-center gap-2 sm:gap-3">
          {navItems.map((item) => (
            <motion.div key={item.label} variants={fadeUp({ distance: 8, duration: motionDurations.fast, reducedMotion })}>
              <motion.div whileHover={reducedMotion ? undefined : "hover"} initial="rest" animate="rest" className="hidden md:block">
                <Link href={item.href} className="group relative inline-flex px-1 py-1 text-sm text-[var(--text-secondary)] transition-colors duration-200 hover:text-white">
                  <motion.span variants={{ rest: { opacity: 0.85 }, hover: { opacity: 1 } }}>{item.label}</motion.span>
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-x-1 -bottom-0.5 h-px origin-left bg-[rgba(0,255,159,0.7)]"
                    variants={{
                      rest: { scaleX: 0, opacity: 0 },
                      hover: { scaleX: 1, opacity: 1 }
                    }}
                    transition={{ duration: motionDurations.fast }}
                  />
                </Link>
              </motion.div>
            </motion.div>
          ))}
          <motion.div variants={fadeUp({ distance: 8, duration: motionDurations.fast, reducedMotion })}>
            <ButtonLink href="#install" className="px-4 py-2.5">
              Install
            </ButtonLink>
          </motion.div>
        </div>
      </motion.nav>
    </motion.header>
  );
}
