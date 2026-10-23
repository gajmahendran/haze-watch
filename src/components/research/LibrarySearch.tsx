"use client";

import { useMemo, useState } from "react";
import type { LibraryRecord } from "@/lib/content/schema";
import { COUNTRIES, countryName, isCountryCode } from "@/lib/domain/countries";
import { LIBRARY_TYPE_LABEL } from "@/lib/ui/library";
import { SearchInput, Select } from "../ui/Controls";
import { EmptyState } from "../ui/States";

function regionLabel(r: string): string {
  return isCountryCode(r) ? countryName(r) : r === "ASEAN" ? "ASEAN" : "Global";
}

export function LibrarySearch({ records }: { records: LibraryRecord[] }) {
  const [q, setQ] = useState("");
  const [type, setType] = useState("all");
  const [region, setRegion] = useState("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");

  const shown = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const list = records.filter((r) => {
      if (type !== "all" && r.type !== type) return false;
      if (region !== "all" && !r.regions.includes(region as LibraryRecord["regions"][number])) return false;
      const hay = `${r.title} ${r.publisher} ${r.summary}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
    return sort === "newest" ? list : [...list].reverse();
  }, [records, q, type, region, sort]);

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-[2fr_1fr_1fr_1fr]">
        <SearchInput label="Search titles, publishers and summaries" value={q} onChange={setQ} placeholder="e.g. peat, school closures, PSI" />
        <Select label="Type" value={type} onChange={setType}>
          <option value="all">All types</option>
          {Object.entries(LIBRARY_TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select label="Country or region" value={region} onChange={setRegion}>
          <option value="all">Anywhere</option>
          <option value="ASEAN">ASEAN</option>
          <option value="GLOBAL">Global</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select label="Order" value={sort} onChange={(v) => setSort(v as "newest" | "oldest")}>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </Select>
      </div>
      <p className="mt-4 text-sm text-ash" aria-live="polite">
        {shown.length} of {records.length} records.
      </p>
      {shown.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Nothing matches">Try fewer words or clear a filter.</EmptyState>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {shown.map((r) => (
            <li key={r.id} className="grid gap-2 py-5 md:grid-cols-[9rem_1fr]">
              <div className="text-sm text-ash">
                {r.publishedDate}
                <span className="block">{LIBRARY_TYPE_LABEL[r.type]}</span>
              </div>
              <div className="min-w-0">
                <a href={r.url} rel="noopener noreferrer" target="_blank" className="font-display text-xl">
                  {r.title}
                </a>
                <p className="text-sm text-ash">
                  {r.publisher}. {r.regions.map(regionLabel).join(", ")}.
                </p>
                <p className="mt-2 max-w-[70ch]">{r.summary}</p>
                <p className="mt-1 text-xs text-dim">Link and details checked {r.verifiedDate}.</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
