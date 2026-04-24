"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export type NavRoute = {
  href: string;
  label: string;
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function NavLinks({ routes }: { routes: NavRoute[] }) {
  const pathname = usePathname() ?? "/";

  return (
    <ul className="flex flex-wrap items-center gap-1 sm:gap-2">
      {routes.map((route) => {
        const active = isActive(pathname, route.href);
        return (
          <li key={route.href}>
            <Link
              href={route.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative inline-flex h-8 items-center rounded-md px-2.5 text-[13px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-brand-purple)]/60",
                active
                  ? "text-[var(--color-brand-purple)]"
                  : "text-white/60 hover:text-white/90",
              )}
            >
              {route.label}
              <span
                aria-hidden
                className={cn(
                  "pointer-events-none absolute inset-x-2.5 -bottom-[1px] h-px origin-center scale-x-0 bg-[var(--color-brand-purple)] transition-transform duration-200",
                  active && "scale-x-100",
                )}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
