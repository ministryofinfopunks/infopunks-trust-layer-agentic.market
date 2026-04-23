"use client";

import { animate, motion, useMotionValue } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { motionEase } from "@/lib/motion/tokens";
import { useReducedMotionSafe } from "@/lib/motion/useReducedMotionSafe";

export function AnimatedNumber({
  value,
  className = "",
  duration = 0.58,
  decimals = 0,
  prefix = "",
  suffix = ""
}) {
  const reducedMotion = useReducedMotionSafe();
  const motionValue = useMotionValue(value);
  const [display, setDisplay] = useState(value);

  const formatter = useMemo(
    () =>
      new Intl.NumberFormat("en-US", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals
      }),
    [decimals]
  );

  useEffect(() => {
    if (reducedMotion) {
      motionValue.set(value);
      setDisplay(value);
      return;
    }

    const controls = animate(motionValue, value, {
      duration,
      ease: motionEase.standard,
      onUpdate: (latest) => {
        setDisplay(latest);
      }
    });

    return () => controls.stop();
  }, [duration, motionValue, reducedMotion, value]);

  return (
    <motion.span layout className={className} aria-live="polite" style={{ fontVariantNumeric: "tabular-nums" }}>
      {prefix}
      {formatter.format(display)}
      {suffix}
    </motion.span>
  );
}
