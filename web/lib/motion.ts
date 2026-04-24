import type { Transition, Variants } from "framer-motion";

export const ease = [0.22, 1, 0.36, 1] as const;

const baseTransition: Transition = {
  duration: 0.4,
  ease,
};

export const cardReveal: Variants = {
  hidden: { y: 12, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { ...baseTransition, duration: 0.4 },
  },
};

export const sectionStagger: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.18,
      delayChildren: 0.05,
    },
  },
};

export const sectionItem: Variants = {
  hidden: { opacity: 0, x: -6 },
  visible: {
    opacity: 1,
    x: 0,
    transition: { duration: 0.22, ease },
  },
};

export const barGrow: Variants = {
  hidden: { scaleY: 0 },
  visible: {
    scaleY: 1,
    transition: { duration: 0.22, ease },
  },
};

export const underlineSweep: Variants = {
  hidden: { scaleX: 0 },
  visible: {
    scaleX: 1,
    transition: { duration: 0.38, ease },
  },
};

export const pulseRing: Variants = {
  idle: {
    scale: 1,
    opacity: 0.6,
  },
  pulse: {
    scale: [1, 1.35, 1],
    opacity: [0.6, 0, 0.6],
    transition: {
      duration: 2.2,
      ease: "easeOut",
      repeat: Infinity,
    },
  },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 0.3, ease },
  },
};

export const viewport = { once: true, margin: "-10% 0px -10% 0px" } as const;
