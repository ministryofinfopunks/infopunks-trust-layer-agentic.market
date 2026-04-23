"use client";

import { motion } from "motion/react";
import { startTransition, useEffect, useState } from "react";
import { CodeFrame } from "./code-frame";
import { usageExample, usagePanels } from "./mock-data";
import { Reveal, RevealGroup } from "@/components/motion/reveal";
import { motionDurations, motionEase } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";

export function UsageSection() {
  const reducedMotion = useReducedMotionSafe();
  const [activePanel, setActivePanel] = useState(usagePanels[0].id);

  useEffect(() => {
    if (reducedMotion) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      startTransition(() => {
        setActivePanel((current) => {
          const index = usagePanels.findIndex((panel) => panel.id === current);
          return usagePanels[(index + 1) % usagePanels.length].id;
        });
      });
    }, 2600);

    return () => window.clearInterval(timer);
  }, [reducedMotion]);

  const activeConfig = usagePanels.find((panel) => panel.id === activePanel) ?? usagePanels[0];

  return (
    <section className="grid gap-6 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:py-16" id="developers">
      <CodeFrame lines={usageExample} activeLines={activeConfig.activeLines} />

      <Reveal className="surface-card p-6 sm:p-8" distance={12} duration={0.32}>
        <span className="section-label">What the SDK returns</span>
        <div className="mt-8 space-y-6">
          <h2 className="section-title">Resolve trust, then route the task with a real decision object.</h2>
          <p className="section-copy-strong">
            This sits inside the execution loop. Trust becomes an input to validator selection, escalation, and event subscriptions before work ships.
          </p>
          <RevealGroup className="grid gap-4" staggerChildren={0.04}>
            {usagePanels.map((panel) => {
              const isActive = panel.id === activePanel;

              return (
                <motion.button
                  key={panel.id}
                  type="button"
                  onMouseEnter={() => setActivePanel(panel.id)}
                  onFocus={() => setActivePanel(panel.id)}
                  variants={{
                    hidden: { opacity: 0, y: reducedMotion ? 0 : 10 },
                    show: {
                      opacity: 1,
                      y: 0,
                      transition: { duration: motionDurations.standard, ease: motionEase.standard }
                    }
                  }}
                  className="surface-panel relative overflow-hidden px-4 py-4 text-left"
                >
                  <motion.span
                    aria-hidden="true"
                    className="absolute left-0 top-0 h-full w-1 rounded-full bg-[var(--accent)]"
                    animate={{ scaleY: isActive ? 1 : 0.32, opacity: isActive ? 1 : 0.35 }}
                    transition={{ duration: motionDurations.standard, ease: motionEase.standard }}
                    style={{ transformOrigin: "top" }}
                  />
                  <motion.p
                    animate={{ opacity: isActive ? 1 : 0.75, y: 0 }}
                    transition={{ duration: motionDurations.standard, ease: motionEase.standard }}
                    className="pl-3 text-base leading-7 text-white"
                  >
                    {panel.title}
                  </motion.p>
                  <motion.p
                    animate={{ opacity: isActive ? 1 : 0.72 }}
                    transition={{ duration: motionDurations.standard, ease: motionEase.standard }}
                    className="pl-3 text-[15px] leading-7 text-[var(--text-secondary)]"
                  >
                    {panel.body}
                  </motion.p>
                </motion.button>
              );
            })}
          </RevealGroup>
        </div>
      </Reveal>
    </section>
  );
}
