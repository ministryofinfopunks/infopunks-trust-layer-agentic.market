import { motionDistances, motionDurations, motionEase, motionTransitions } from "./tokens";

function safeDistance(distance, reducedMotion) {
  return reducedMotion ? 0 : distance;
}

function transitionFor(duration, delay = 0, reducedMotion = false, ease = motionEase.standard) {
  if (reducedMotion) {
    return { duration: 0.01, delay: 0 };
  }

  return {
    duration,
    delay,
    ease
  };
}

export function fadeIn({ duration = motionDurations.standard, delay = 0 } = {}) {
  return {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: transitionFor(duration, delay)
    },
    exit: {
      opacity: 0,
      transition: transitionFor(motionDurations.fast, 0, false, motionEase.exit)
    }
  };
}

export function fadeUp({
  distance = motionDistances.md,
  duration = motionDurations.standard,
  delay = 0,
  reducedMotion = false
} = {}) {
  return {
    hidden: { opacity: 0, y: safeDistance(distance, reducedMotion) },
    show: {
      opacity: 1,
      y: 0,
      transition: transitionFor(duration, delay, reducedMotion)
    },
    exit: {
      opacity: 0,
      y: safeDistance(motionDistances.xs, reducedMotion),
      transition: transitionFor(motionDurations.fast, 0, reducedMotion, motionEase.exit)
    }
  };
}

export function scaleIn({
  distance = motionDistances.sm,
  duration = motionDurations.deliberate,
  scale = 0.985,
  delay = 0,
  reducedMotion = false
} = {}) {
  return {
    hidden: {
      opacity: 0,
      y: safeDistance(distance, reducedMotion),
      scale: reducedMotion ? 1 : scale
    },
    show: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: transitionFor(duration, delay, reducedMotion)
    },
    exit: {
      opacity: 0,
      scale: reducedMotion ? 1 : 0.995,
      transition: transitionFor(motionDurations.fast, 0, reducedMotion, motionEase.exit)
    }
  };
}

export function staggerContainer({
  delayChildren = 0,
  staggerChildren = 0.05,
  reducedMotion = false
} = {}) {
  return {
    hidden: {},
    show: {
      transition: {
        delayChildren,
        staggerChildren: reducedMotion ? 0 : staggerChildren
      }
    }
  };
}

export function cardReveal({ reducedMotion = false, delay = 0 } = {}) {
  return scaleIn({
    distance: motionDistances.md,
    duration: motionDurations.deliberate,
    scale: 0.99,
    delay,
    reducedMotion
  });
}

export const hoverLift = {
  rest: {
    y: 0,
    boxShadow: "0 0 0 1px rgba(255,255,255,0.06), 0 16px 44px rgba(0,0,0,0.4)"
  },
  hover: {
    y: -3,
    boxShadow: "0 0 0 1px rgba(0,255,159,0.16), 0 20px 54px rgba(0,0,0,0.46)",
    transition: motionTransitions.hover
  }
};

export const logEntry = {
  hidden: { opacity: 0, y: motionDistances.xs },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.16,
      ease: motionEase.standard
    }
  },
  exit: {
    opacity: 0,
    transition: {
      duration: motionDurations.fast,
      ease: motionEase.exit
    }
  }
};

export const feedEntry = {
  hidden: { opacity: 0, y: motionDistances.sm },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.24,
      ease: motionEase.standard
    }
  },
  exit: {
    opacity: 0,
    y: -motionDistances.xs,
    transition: {
      duration: motionDurations.fast,
      ease: motionEase.exit
    }
  }
};

export const quarantineSequence = {
  initial: {
    borderColor: "rgba(255,255,255,0.08)",
    boxShadow: "0 0 0 rgba(0,0,0,0)",
    backgroundColor: "rgba(255,255,255,0.02)"
  },
  critical: {
    borderColor: "rgba(255,93,115,0.28)",
    boxShadow: "0 0 0 1px rgba(255,93,115,0.14), 0 18px 44px rgba(255,93,115,0.07)",
    transition: {
      duration: motionDurations.fast,
      ease: motionEase.standard
    }
  }
};

export const graphPulse = {
  idle: {
    opacity: 0.18
  },
  active: {
    opacity: 0.84,
    transition: transitionFor(motionDurations.fast, 0, false, motionEase.standard)
  },
  release: {
    opacity: 0.32,
    transition: transitionFor(motionDurations.fast, 0, false, motionEase.exit)
  }
};

export const stateSweep = {
  idle: {
    opacity: 0
  },
  active: {
    opacity: [0, 0.16, 0],
    transition: {
      duration: motionDurations.standard,
      ease: motionEase.standard
    }
  }
};
