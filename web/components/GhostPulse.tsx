"use client";

import { motion } from "framer-motion";

export function GhostPulse() {
  return (
    <span className="relative inline-flex h-3 w-3 items-center justify-center" aria-hidden>
      <motion.span
        className="absolute inline-flex h-full w-full rounded-full"
        style={{ backgroundColor: "rgba(167, 139, 250, 0.35)" }}
        animate={{ scale: [1, 1.9, 1], opacity: [0.55, 0, 0.55] }}
        transition={{ duration: 2.6, ease: "easeOut", repeat: Infinity }}
      />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-brand-purple)]/70" />
    </span>
  );
}
