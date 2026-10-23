import type { Metadata } from "next";
import Link from "next/link";
import { ConnectionBadge } from "@/components/ui/Badge";
import { loadCountryProfile } from "@/lib/content/loader";
import { COUNTRIES } from "@/lib/domain/countries";
import { REAL_AIR_PROVIDERS } from "@/lib/providers/registry";

export const metadata: Metadata = {
  title: "Country profiles",
  description: "Air quality agencies, national indices, monitoring coverage, haze seasons and data access for ten Southeast Asian countries.",
  alternates: { canonical: "/countries" },
};

export default function CountriesPage() {
  return (
    <div className="wrap pt-10">
      <h1 className="text-3xl md:text-4xl">Country profiles</h1>
      <p className="mt-4 max-w-[62ch] text-lg text-ash">
        Malaysia and Singapore are researched in depth. The other eight profiles are partial: they record what the sources we checked support
        and list what is still unknown.
      </p>
      <ul className="mt-10 grid gap-x-10 gap-y-2 md:grid-cols-2">
        {COUNTRIES.map((c) => {
          const p = loadCountryProfile(c.code);
          const live = REAL_AIR_PROVIDERS.filter((x) => x.role === "live" && x.countries.includes(c.code));
          const connected = live.some((x) => x.connection({}).status === "connected");
          return (
            <li key={c.code} className="flex items-baseline justify-between gap-4 border-t border-line py-4">
              <span>
                <Link href={`/countries/${c.slug}`} className="font-display text-2xl">
                  {c.name}
                </Link>
                <span className="block text-sm text-ash">
                  {p?.nationalIndex ? p.nationalIndex.name : "No national index documented here yet"}. Profile {p?.status === "researched" ? "researched" : "partial"}.
                </span>
              </span>
              <ConnectionBadge connected={connected} label={connected ? "Live data" : live.length ? "Live source not connected" : "Planned"} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
