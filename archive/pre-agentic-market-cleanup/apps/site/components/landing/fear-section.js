"use client";

import { motion } from "motion/react";
import { Reveal } from "@/components/motion/reveal";
import { motionDurations, motionEase } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";

export function FearSection() {
  const reducedMotion = useReducedMotionSafe();

  return (
    <section className="py-12 text-center lg:py-20">
      <Reveal className="mx-auto max-w-[900px]" distance={12} duration={0.32}>
        <span className="section-label">The Risk</span>
        <div className="mt-8 space-y-6">
          <motion.h2
            initial={{ opacity: 0, y: reducedMotion ? 0 : 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ duration: motionDurations.deliberate, ease: motionEase.standard }}
            className="section-title sm:text-[clamp(3rem,5vw,4.5rem)]"
          >
            You are deploying agents that can act.
            <br />
            But you do not know if they should.
          </motion.h2>
          <motion.p
            initial={{ opacity: 0.5, y: reducedMotion ? 0 : 8 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, amount: 0.6 }}
            transition={{ delay: 0.12, duration: 0.28, ease: motionEase.standard }}
            className="section-copy mx-auto max-w-[620px]"
          >
            That gap is where systems break. Trust has to exist before execution, not after the postmortem.
          </motion.p>
        </div>
      </Reveal>
    </section>
  );
}
