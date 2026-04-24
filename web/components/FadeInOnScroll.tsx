"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { cardReveal, viewport } from "@/lib/motion";

export interface FadeInOnScrollProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

/**
 * Thin client wrapper so server components can participate in
 * whileInView reveal animations without becoming client components
 * themselves. Uses the shared `cardReveal` preset.
 */
export function FadeInOnScroll({ children, className, delay = 0 }: FadeInOnScrollProps) {
  return (
    <motion.div
      className={className}
      variants={cardReveal}
      initial="hidden"
      whileInView="visible"
      viewport={viewport}
      transition={delay ? { delay } : undefined}
    >
      {children}
    </motion.div>
  );
}
