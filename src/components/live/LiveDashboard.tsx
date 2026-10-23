"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { COUNTRIES, countryName, getCountry, type CountryCode } from "@/lib/domain/countries";
import { worstState } from "@/lib/domain/freshness";
import { groupByIndex, INDEX_REGISTRY, rankIndexReadings } from "@/lib/domain/indices";
import type { IndexObservation, Observation, Snapshot, Station } from "@/lib/domain/schemas";
import { formatInZone } from "@/lib/domain/time";
import {
  bandColor,
  describeReading,
  formatObservedAt,
  freshnessFor,
  observationForView,
  VIEW_LABELS,
  type ViewMode,
} from "@/lib/ui/readings";
import { useApi, useNow } from "@/lib/ui/useApi";
import { HazeMap, type MapMarker } from "../map/Map";
import { BandBadge, ConnectionBadge, DemoBadge, FreshnessBadge } from "../ui/Badge";
import { InfoTip, SearchInput, Segmented, Select } from "../ui/Controls";
import { EmptyState, ErrorState, LoadingBlock, Note } from "../ui/States";
import { StationPanel } from "./StationPanel";

const REFRESH_MS = 5 * 60_000;

export function useSnapshot() {
  return useApi<Snapshot>("/api/snapshot", { intervalMs: REFRESH_MS });
}

export function newestReading(snapshot: Snapshot): string | null {
  return snapshot.observations.filter((o) => o.kind !== "weather").reduce<string | null>((m, o) => (m === null || o.observedAtUtc > m ? o.observedAtUtc : m), null);
}

/** Last-updated line. Times in UTC+8 (Malaysia and Singapore share the offset), with the zone named. */
export function LastUpdated({ snapshot }: { snapshot: Snapshot }) {
  const newest = newestReading(snapshot);
  return (
    <p className="text-sm text-ash">
      <span className="text-smoke">Last updated {formatInZone(snapshot.generatedAtUtc, "Asia/Kuala_Lumpur")}.</span>{" "}
      {newest ? `Newest reading is from ${formatInZone(newest, "Asia/Kuala_Lumpur")}.` : "No readings are available right now."}
    </p>
  );
}

function coverage(snapshot: Snapshot) {
  return COUNTRIES.map((c) => {
    const live = snapshot.providers.filter((p) => p.role === "live" && p.countries.includes(c.code) && p.accessMethod !== "demo");
    const connected = live.filter((p) => p.connection.status === "connected");
    const reporting = snapshot.stations.filter((s) => s.countryCode === c.code && s.providerId !== "demo-air" && snapshot.observations.some((o) => o.stationId === s.id && o.kind !== "weather"));
    return { country: c, live, connected, reporting: reporting.length };
  });
}

export function LiveDashboard({ initialCountry }: { initialCountry?: CountryCode }) {
  const snap = useSnapshot();
  const now = useNow();
  const [view, setView] = useState<ViewMode>("index");
  const [country, setCountry] = useState<string>(initialCountry ?? "all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const data = snap.data;
  const airStations = useMemo(() => (data ? data.stations.filter((s) => !s.providerId.endsWith("weather")) : []), [data]);
  const weatherStations = useMemo(() => (data ? data.stations.filter((s) => s.providerId.endsWith("weather")) : []), [data]);
  const weatherObs = useMemo(() => (data ? data.observations.filter((o) => o.kind === "weather") : []), [data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return airStations.filter(
      (s) =>
        (country === "all" || s.countryCode === country) &&
        (!q || s.name.toLowerCase().includes(q) || (s.area ?? "").toLowerCase().includes(q) || countryName(s.countryCode).toLowerCase().includes(q)),
    );
  }, [airStations, country, query]);

  const markers: MapMarker[] = useMemo(() => {
    if (!data) return [];
    return visible.flatMap((s) => {
      if (s.latitude === null || s.longitude === null) return [];
      const o = observationForView(data.observations, s.id, view);
      const d = o ? describeReading(o) : null;
      return [
        {
          id: s.id,
          lat: s.latitude,
          lon: s.longitude,
          text: d && o?.value !== null ? d.valueText : "–",
          color: bandColor(d?.band?.level ?? null),
          muted: !o || o.value === null,
          shape: s.kind === "region_aggregate" ? "square" : "pill",
          title: d ? `${s.name}: ${d.metricLabel} ${d.valueText}${d.isIndex ? ` (${d.scaleLabel})` : ` ${d.scaleLabel}`}${d.band ? `, ${d.band.label}` : ""}` : `${s.name}: no reading for this view`,
        } satisfies MapMarker,
      ];
    });
  }, [data, visible, view]);

  const selectedStation = airStations.find((s) => s.id === selected) ?? null;
  const fitTo = useMemo<[[number, number], [number, number]] | null>(() => {
    if (country === "all") return [[-8, 95], [21, 125]];
    const c = getCountry(country as CountryCode);
    return [[c.bbox[1], c.bbox[0]], [c.bbox[3], c.bbox[2]]];
  }, [country]);

  if (snap.status === "loading") return <LoadingBlock label="Loading the latest readings" className="mt-8" />;
  if (!data) {
    return (
      <ErrorState title="Live readings could not be loaded" onRetry={snap.reload}>
        {snap.error} No readings are shown rather than estimated ones.
      </ErrorState>
    );
  }

  const freshness = now ? worstState(data.observations.filter((o) => o.kind !== "weather").map((o) => freshnessFor(o, data.providers, now).state)) : "unknown";
  const countryInfo = country === "all" ? null : coverage(data).find((c) => c.country.code === country);

  return (
    <div className="mt-8 space-y-8">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <LastUpdated snapshot={data} />
        <FreshnessBadge state={freshness} reason="The least up-to-date reading currently shown." />
        {data.demoMode ? <DemoBadge /> : null}
        <button type="button" onClick={snap.reload} className="rounded border border-line-strong px-3 py-1 text-sm hover:border-ash">
          Refresh
        </button>
      </div>

      {snap.status === "error" ? (
        <ErrorState title="The latest refresh failed">
          {snap.error} The readings below are from the previous successful check, with their own timestamps.
        </ErrorState>
      ) : null}
      {data.demoMode ? (
        <Note tone="demo">
          Development demo mode is on. Stations named DEMO show synthetic values, not measurements. Demo mode cannot be enabled in a
          production build.
        </Note>
      ) : null}
      {data.warnings.filter((w) => !w.includes("demo mode")).length > 0 ? (
        <div className="space-y-2" aria-live="polite">
          {data.warnings
            .filter((w) => !w.includes("demo mode"))
            .map((w) => (
              <Note key={w} tone="warn">
                {w}
              </Note>
            ))}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-[auto_1fr_1fr] md:items-end">
        <Segmented
          label="What to show"
          value={view}
          onChange={setView}
          options={(Object.keys(VIEW_LABELS) as ViewMode[]).map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
        />
        <Select label="Country" value={country} onChange={(v) => (setCountry(v), setSelected(null))}>
          <option value="all">All countries</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
        <SearchInput label="Find a city, region or station" value={query} onChange={setQuery} placeholder="e.g. Kuching, west" />
      </div>
      <Note>
        {view === "index"
          ? "Each country's index is shown on its own scale. Singapore's PSI and Malaysia's API are calculated differently and are never ranked together."
          : "PM2.5 concentrations in µg/m³ for one averaging period at a time. Only stations reporting this exact measure are coloured."}
      </Note>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div>
          <HazeMap
            ariaLabel="Map of monitoring stations and regional readings. A table with the same readings follows the map."
            markers={markers}
            selectedId={selected}
            onSelect={setSelected}
            fitTo={fitTo}
            className="h-[26rem] lg:h-[34rem]"
          />
          <p className="mt-2 text-xs text-dim">Square markers are regional figures published by an agency, placed at its label position. Round markers are monitoring stations.</p>
        </div>
        <div>
          {selectedStation && now ? (
            <StationPanel
              station={selectedStation}
              observations={data.observations}
              weather={weatherObs}
              weatherStations={weatherStations}
              providers={data.providers}
              view={view}
              now={now}
              onClose={() => setSelected(null)}
            />
          ) : countryInfo && countryInfo.reporting === 0 ? (
            <EmptyState title={`No live readings for ${countryInfo.country.name}`} action={<Link href={`/countries/${countryInfo.country.slug}`}>Read the {countryInfo.country.name} profile</Link>}>
              {countryInfo.live.length > 0
                ? `${countryInfo.live.map((p) => p.name).join(", ")}: ${countryInfo.live.map((p) => (p.connection.status === "not_connected" ? p.connection.detail : "no readings in the latest check")).join(" ")}`
                : "This country is on the coverage plan. No documented live source has been connected yet, so nothing is shown rather than estimated values."}
            </EmptyState>
          ) : (
            <EmptyState title="Select a station or region">Choose a marker on the map or a row in the table to see every reported value, its source and recent history.</EmptyState>
          )}
        </div>
      </div>

      <ReadingsTables
        stations={visible}
        observations={data.observations}
        providers={data.providers}
        view={view}
        now={now}
        onSelect={(id) => {
          setSelected(id);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }}
      />

      <CoverageTable snapshot={data} />
    </div>
  );
}

function ReadingsTables({
  stations,
  observations,
  providers,
  view,
  now,
  onSelect,
}: {
  stations: Station[];
  observations: Observation[];
  providers: Snapshot["providers"];
  view: ViewMode;
  now: Date | null;
  onSelect: (id: string) => void;
}) {
  const rows = stations.map((s) => ({ s, o: observationForView(observations, s.id, view) })).filter((r) => r.o);
  if (rows.length === 0) {
    return <EmptyState title="No stations report this measure in the current selection">Try another view or country.</EmptyState>;
  }

  // Index view: one table per scale. Concentration view: one table, same unit and averaging.
  const groups: { title: string; note: string; rows: typeof rows }[] = [];
  if (view === "index") {
    const byIndex = groupByIndex(rows.map((r) => ({ ...r, indexId: (r.o as IndexObservation).indexId, value: r.o!.value })));
    for (const [indexId, list] of byIndex) {
      groups.push({ title: INDEX_REGISTRY[indexId].shortName, note: INDEX_REGISTRY[indexId].scaleNote, rows: rankIndexReadings(list) });
    }
  } else {
    const sorted = [...rows].sort((a, b) => (b.o!.value ?? -1) - (a.o!.value ?? -1));
    groups.push({ title: VIEW_LABELS[view], note: "Concentrations measured over the same averaging period.", rows: sorted });
  }

  return (
    <section aria-labelledby="readings-heading">
      <h2 id="readings-heading" className="text-2xl">
        Readings table
      </h2>
      <p className="mt-1 text-sm text-ash">The same data as the map, for keyboard and screen reader users.</p>
      {groups.map((g) => (
        <div key={g.title} className="mt-6 overflow-x-auto" tabIndex={0} role="region" aria-label={`${g.title} readings table`}>
          <h3 className="text-lg">
            {g.title} <InfoTip label={`About ${g.title}`}>{g.note}</InfoTip>
          </h3>
          <table className="data-table mt-2 min-w-[40rem]">
            <thead>
              <tr>
                <th scope="col">Station or region</th>
                <th scope="col" className="num">
                  Value
                </th>
                <th scope="col">Category</th>
                <th scope="col">Reported</th>
                <th scope="col">Freshness</th>
              </tr>
            </thead>
            <tbody>
              {g.rows.map(({ s, o }) => {
                const d = describeReading(o!);
                const f = now ? freshnessFor(o!, providers, now) : null;
                return (
                  <tr key={s.id}>
                    <td>
                      <button type="button" className="text-left text-lichen underline decoration-1 underline-offset-2" onClick={() => onSelect(s.id)}>
                        {s.name}
                      </button>
                      {o!.provenance === "demo" ? <span className="ml-2"><DemoBadge /></span> : null}
                    </td>
                    <td className="num whitespace-nowrap">
                      {d.valueText} <span className="text-ash">{d.isIndex ? "" : d.scaleLabel}</span>
                    </td>
                    <td>{d.band ? <BandBadge level={d.band.level} label={d.band.label} scaleName={d.band.scaleName} /> : <span className="text-dim">None published</span>}</td>
                    <td className="text-ash">{formatObservedAt(o!.observedAtUtc, o!.countryCode)}</td>
                    <td>{f ? <FreshnessBadge state={f.state} reason={f.reason} /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </section>
  );
}

function CoverageTable({ snapshot }: { snapshot: Snapshot }) {
  const rows = coverage(snapshot);
  return (
    <section aria-labelledby="coverage-heading">
      <h2 id="coverage-heading" className="text-2xl">
        Coverage
      </h2>
      <p className="mt-1 text-sm text-ash measure">
        Operational means a documented source is connected. Planned countries have no live source yet, so they show no readings.
      </p>
      <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="Coverage by country table">
        <table className="data-table min-w-[36rem]">
          <thead>
            <tr>
              <th scope="col">Country</th>
              <th scope="col">Live coverage</th>
              <th scope="col" className="num">
                Reporting now
              </th>
              <th scope="col">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.country.code}>
                <td>
                  <Link href={`/countries/${r.country.slug}`}>{r.country.name}</Link>
                </td>
                <td>
                  {r.connected.length > 0 ? (
                    <ConnectionBadge connected label="Operational" />
                  ) : r.live.length > 0 ? (
                    <ConnectionBadge connected={false} label="Source not connected" />
                  ) : (
                    <ConnectionBadge connected={false} label="Planned" />
                  )}
                </td>
                <td className="num">{r.reporting}</td>
                <td className="text-ash">
                  {r.live.map((p) => p.name).join(", ") || "No documented live source identified yet"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
