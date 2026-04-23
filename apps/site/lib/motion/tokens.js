export const motionDurations = {
  micro: 0.12,
  fast: 0.18,
  standard: 0.24,
  deliberate: 0.32,
  long: 0.6,
  ambient: 2.4
};

export const motionDistances = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16
};

export const motionEase = {
  standard: [0.22, 1, 0.36, 1],
  exit: [0.4, 0, 1, 1],
  linear: "linear"
};

export const motionSpring = {
  calm: {
    type: "spring",
    stiffness: 180,
    damping: 28,
    mass: 0.9
  },
  steady: {
    type: "spring",
    stiffness: 220,
    damping: 30,
    mass: 0.8
  },
  settle: {
    type: "spring",
    stiffness: 140,
    damping: 22,
    mass: 1
  }
};

export const motionTransitions = {
  micro: { duration: motionDurations.micro, ease: motionEase.standard },
  fast: { duration: motionDurations.fast, ease: motionEase.standard },
  standard: { duration: motionDurations.standard, ease: motionEase.standard },
  deliberate: { duration: motionDurations.deliberate, ease: motionEase.standard },
  long: { duration: motionDurations.long, ease: motionEase.standard },
  layout: { duration: motionDurations.standard, ease: motionEase.standard },
  ambient: {
    duration: 3.6,
    ease: motionEase.standard,
    repeat: Number.POSITIVE_INFINITY,
    repeatType: "reverse"
  },
  hover: {
    duration: 0.16,
    ease: motionEase.standard
  },
  settle: {
    duration: 0.28,
    ease: motionEase.standard
  },
  pulse: {
    duration: 0.72,
    ease: motionEase.standard
  },
  graph: {
    duration: 0.24,
    ease: motionEase.standard
  }
};
