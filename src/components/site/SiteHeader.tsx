"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { COUNTRIES } from "@/lib/domain/countries";

export const NAV = [
  { href: "/live", label: "Live air quality" },
  { href: "/history", label: "Historical haze" },
  { href: "/hotspots", label: "Fire hotspots" },
  { href: "/data", label: "Data explorer" },
  { href: "/research", label: "Research" },
  { href: "/learn", label: "Learn" },
  { href: "/about", label: "About" },
] as const;

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
      <circle cx="16" cy="15" r="9" fill="#e4e1d8" opacity="0.92" />
      <rect x="3" y="15" width="26" height="2.2" rx="1.1" fill="#121815" />
      <rect x="5" y="19.5" width="22" height="2.2" rx="1.1" fill="#121815" />
      <rect x="2" y="24" width="28" height="2" rx="1" fill="#46604f" />
    </svg>
  );
}

function CountrySelect() {
  const router = useRouter();
  const pathname = usePathname();
  const current = COUNTRIES.find((c) => pathname === `/countries/${c.slug}`)?.slug ?? "";
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">Go to a country profile</span>
      <select
        className="field min-h-9 w-auto py-1 pr-7"
        value={current}
        onChange={(e) => {
          if (e.target.value) router.push(`/countries/${e.target.value}`);
        }}
      >
        <option value="">Countries</option>
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.slug}>
            {c.name}
            {c.mvpPriority ? "" : " (planned)"}
          </option>
        ))}
      </select>
    </label>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header className="sticky top-0 z-[1100] border-b border-line bg-ground/95 backdrop-blur supports-[backdrop-filter]:bg-ground/85">
      <div className="wrap flex h-16 items-center gap-4">
        <Link href="/" className="flex items-center gap-2.5 text-smoke no-underline hover:text-smoke" onClick={() => setOpen(false)}>
          <Logo />
          <span className="leading-none">
            <span className="block font-display text-[1.35rem]">Haze Watch</span>
            <span className="block text-[11px] text-ash">Southeast Asia</span>
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden lg:block">
          <ul className="flex items-center gap-1">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={`rounded px-2.5 py-1.5 text-sm no-underline ${isActive(n.href) ? "bg-canopy text-smoke" : "text-ash hover:text-smoke"}`}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto hidden sm:block lg:ml-2">
          <CountrySelect />
        </div>
        <button
          type="button"
          className="ml-auto rounded border border-line-strong px-3 py-1.5 text-sm sm:ml-0 lg:hidden"
          aria-expanded={open}
          aria-controls="mobile-nav"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Close" : "Menu"}
        </button>
      </div>
      {open ? (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-ground lg:hidden">
          <ul className="wrap py-3">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  onClick={() => setOpen(false)}
                  aria-current={isActive(n.href) ? "page" : undefined}
                  className={`block rounded px-2 py-2.5 no-underline ${isActive(n.href) ? "bg-canopy text-smoke" : "text-smoke"}`}
                >
                  {n.label}
                </Link>
              </li>
            ))}
            <li className="px-2 pt-3 sm:hidden">
              <CountrySelect />
            </li>
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
