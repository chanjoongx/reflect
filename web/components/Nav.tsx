import Link from "next/link";
import { CircleDot } from "lucide-react";
import { NavLinks, type NavRoute } from "./NavLinks";

const routes: NavRoute[] = [
  { href: "/", label: "Dashboard" },
  { href: "/reflections", label: "Reflections" },
  { href: "/patterns", label: "Patterns" },
  { href: "/install", label: "Install" },
];

export function Nav() {
  return (
    <header
      className="sticky top-0 z-40 h-14 w-full border-b border-white/5 backdrop-blur bg-[--color-bg]/80"
      role="banner"
    >
      <div className="mx-auto flex h-full w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          aria-label="reflect home"
          className="group flex items-center gap-2 outline-none"
        >
          <span className="relative inline-flex h-2 w-2 items-center justify-center">
            <span
              aria-hidden
              className="absolute inline-flex h-2 w-2 rounded-full bg-[var(--color-brand-teal)]/40 animate-ping [animation-duration:3s]"
            />
            <CircleDot
              aria-hidden
              className="relative h-3.5 w-3.5 text-[var(--color-brand-teal)]"
              strokeWidth={2.25}
            />
          </span>
          <span className="ml-1 text-[15px] font-medium tracking-tight text-white/95 group-hover:text-white">
            reflect
          </span>
          <span aria-hidden className="text-white/20">·</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/40">
            localhost
          </span>
        </Link>

        <nav aria-label="Primary">
          <NavLinks routes={routes} />
        </nav>
      </div>
    </header>
  );
}
