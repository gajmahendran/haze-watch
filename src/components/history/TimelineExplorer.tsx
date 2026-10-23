"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { COUNTRIES, countryName } from "@/lib/domain/countries";
import type { HazeEvent } from "@/lib/content/schema";
import { SEVERITY_LABEL, SEVERITY_WEIGHT, STATUS_LABEL, TYPE_LABEL, yearsLabel } from "@/lib/ui/events";
import { Select } from "../ui/Controls";
import { EmptyState } from "../ui/States";

export function TimelineExplorer({ events }: { events: HazeEvent[] }) {
  const [country, setCountry] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [type, setType] = useState("all");
  const [from, setFrom] = useState(String(Math.min(...events.map((e) => e.yearStart))));
  const [to, setTo] = useState(String(Math.max(...events.map((e) => e.yearEnd))));
  const years = useMemo(() => [...new Set(events.flatMap((e) => [e.yearStart, e.yearEnd]))].sort(), [events]);

  const shown = events.filter(
    (e) =>
      (country === "all" || e.countries.includes(country as HazeEvent["countries"][number])) &&
      (severity === "all" || e.severity === severity) &&
      (type === "all" || e.type === type) &&
      e.yearEnd >= Number(from) &&
      e.yearStart <= Number(to),
  );

  return (
    <div>
      <form className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()} aria-label="Filter episodes">
        <Select label="From year" value={from} onChange={setFrom}>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </Select>
        <Select label="To year" value={to} onChange={setTo}>
          {years.map((y) => (
            <option key={y}>{y}</option>
          ))}
        </Select>
        <Select label="Country affected" value={country} onChange={setCountry}>
          <option value="all">Any country</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
        <Select label="Severity" value={severity} onChange={setSeverity}>
          <option value="all">Any severity</option>
          {Object.entries(SEVERITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        <Select label="Type" value={type} onChange={setType}>
          <option value="all">Any type</option>
          {Object.entries(TYPE_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
      </form>
      <p className="mt-4 text-sm text-ash" aria-live="polite">
        Showing {shown.length} of {events.length} episodes.
      </p>

      {shown.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No episodes match these filters">Widen the year range or clear a filter.</EmptyState>
        </div>
      ) : (
        <ol className="relative mt-8 border-l border-line-strong pl-8">
          {shown.map((e) => (
            <li key={e.slug} className="relative pb-12 last:pb-2">
              <span
                aria-hidden
                className={`absolute -left-[2.45rem] top-2 size-3.5 rounded-full border-2 ${SEVERITY_WEIGHT[e.severity] === 0 ? "border-dashed border-ash bg-ground" : "border-smoke bg-smoke"}`}
              />
              <p className="numeral text-3xl text-ash">{yearsLabel(e)}</p>
              <h3 className="mt-1 text-2xl">
                <Link href={`/history/${e.slug}`}>{e.title}</Link>
              </h3>
              <p className="mt-1 text-sm text-ash">
                {e.datesLabel}. {TYPE_LABEL[e.type]}. Severity: {SEVERITY_LABEL[e.severity]}. {STATUS_LABEL[e.status]}.
              </p>
              <p className="mt-3 max-w-[66ch] font-display text-[1.0625rem] leading-relaxed">{e.summary}</p>
              <p className="mt-2 text-sm text-ash">
                Countries: {e.countries.map(countryName).join(", ")}. {e.sources.length} sources.
              </p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
