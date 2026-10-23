"use client";

import { useMemo } from "react";
import { countryName } from "@/lib/domain/countries";
import type { Observation, ProviderStatus, Station } from "@/lib/domain/schemas";
import { localDateKey } from "@/lib/domain/time";
import type { HistoryResponse } from "@/lib/pipeline/service";
import { describeReading, distanceKm, formatObservedAt, freshnessFor, stationKindLabel, zoneForCountry, type ViewMode } from "@/lib/ui/readings";
import { useApi } from "@/lib/ui/useApi";
import { TimeSeriesChart, ChartTable } from "../charts/TimeSeriesChart";
import { ReadingStrip } from "../readings/ReadingStrip";
import { BandBadge, DemoBadge, FreshnessBadge } from "../ui/Badge";
import { ErrorState, LoadingBlock, Note } from "../ui/States";

const ORDER: Record<string, number> = { index: 0, concentration: 1, weather: 2 };

function viewMetric(view: ViewMode, station: Station): { metric: string; period: string } {
  if (view === "index") {
    return station.countryCode === "SG"
      ? { metric: "index:SG_PSI", period: "PT24H" }
      : { metric: "index:MY_API", period: "PT1H" };
  }
  return { metric: "concentration:PM2.5", period: view === "pm25_1h" ? "PT1H" : "PT24H" };
}

export function StationPanel({
  station,
  observations,
  weather,
  weatherStations,
  providers,
  view,
  now,
  onClose,
}: {
  station: Station;
  observations: Observation[];
  weather: Observation[];
  weatherStations: Station[];
  providers: ProviderStatus[];
  view: ViewMode;
  now: Date;
  onClose: () => void;
}) {
  const own = useMemo(
    () => observations.filter((o) => o.stationId === station.id).sort((a, b) => ORDER[a.kind]! - ORDER[b.kind]! || a.averagingPeriod.localeCompare(b.averagingPeriod)),
    [observations, station.id],
  );
  const primary = own.find((o) => (view === "index" ? o.kind === "index" : o.kind === "concentration" && o.pollutant === "PM2.5" && o.averagingPeriod === (view === "pm25_1h" ? "PT1H" : "PT24H")));
  const provider = providers.find((p) => p.id === station.providerId);
  const zone = zoneForCountry(station.countryCode);
  const isDemo = own.some((o) => o.provenance === "demo");

  // Nearest weather station, for context only.
  const nearest = useMemo(() => {
    if (station.latitude === null || station.longitude === null) return null;
    const here = { latitude: station.latitude, longitude: station.longitude };
    let best: { s: Station; km: number } | null = null;
    for (const s of weatherStations) {
      if (s.latitude === null || s.longitude === null || s.countryCode !== station.countryCode) continue;
      const km = distanceKm(here, { latitude: s.latitude, longitude: s.longitude });
      if (!best || km < best.km) best = { s, km };
    }
    return best;
  }, [station, weatherStations]);
  const nearestReadings = nearest ? weather.filter((o) => o.stationId === nearest.s.id) : [];

  // Two local days of history for the selected view.
  const today = localDateKey(now.toISOString(), zone);
  const yesterday = localDateKey(new Date(now.getTime() - 86_400_000).toISOString(), zone);
  const { metric, period } = viewMetric(view, station);
  const canChart = station.providerId !== "my-opendosm";
  const historyUrl = canChart
    ? `/api/history?provider=${encodeURIComponent(station.providerId)}&station=${encodeURIComponent(station.id)}&metric=${encodeURIComponent(metric)}&period=${period}&from=${yesterday}&to=${today}`
    : null;
  const history = useApi<HistoryResponse>(historyUrl);

  const strip = primary ? describeReading(primary) : null;

  return (
    <article aria-labelledby="station-title" className="rounded-[var(--radius-panel)] border border-line bg-forest p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="station-title" className="text-2xl">
            {station.name}
          </h2>
          <p className="mt-1 text-sm text-ash">
            {stationKindLabel(station)}, {countryName(station.countryCode)}
            {station.latitude !== null && station.longitude !== null ? (
              <>
                <br />
                {station.kind === "region_aggregate" ? "Label position" : "Location"} {station.latitude.toFixed(3)}, {station.longitude.toFixed(3)}
              </>
            ) : null}
          </p>
        </div>
        <button type="button" onClick={onClose} className="rounded border border-line-strong px-2 py-1 text-sm text-ash hover:text-smoke">
          Close
        </button>
      </div>
      {isDemo ? (
        <div className="mt-3">
          <DemoBadge />
        </div>
      ) : null}

      <div className="mt-5">
        {primary && strip ? (
          <ReadingStrip
            size="medium"
            value={primary.value}
            scale={
              primary.kind === "index"
                ? { kind: "index", indexId: primary.indexId }
                : primary.kind === "concentration" && primary.averagingPeriod === "PT1H" && primary.countryCode === "SG"
                  ? { kind: "sg_pm25_1h" }
                  : { kind: "none" }
            }
            metricLabel={strip.metricLabel}
            unitLabel={strip.isIndex ? strip.scaleLabel : strip.scaleLabel}
            bandLabel={strip.band?.label}
          />
        ) : (
          <Note>This station has no reading for the selected view.</Note>
        )}
      </div>

      <h3 className="mt-6 text-lg">All reported values</h3>
      <table className="data-table mt-2">
        <caption className="sr-only">Latest readings at {station.name}</caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            <th scope="col" className="num">
              Value
            </th>
            <th scope="col">Category</th>
          </tr>
        </thead>
        <tbody>
          {own.map((o) => {
            const d = describeReading(o);
            const f = freshnessFor(o, providers, now);
            return (
              <tr key={`${o.kind}-${d.metricLabel}`}>
                <td>
                  {d.metricLabel}
                  <span className="block text-xs text-dim">
                    {formatObservedAt(o.observedAtUtc, o.countryCode)}
                    <br />
                    Source time: {o.original.timestamp}
                  </span>
                  <span className="mt-1 block">
                    <FreshnessBadge state={f.state} reason={f.reason} />
                  </span>
                </td>
                <td className="num whitespace-nowrap">
                  {d.valueText} <span className="text-ash">{d.isIndex ? "" : d.scaleLabel}</span>
                </td>
                <td>{d.band ? <BandBadge level={d.band.level} label={d.band.label} scaleName={d.band.scaleName} /> : <span className="text-dim">No published category</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {nearest ? (
        <>
          <h3 className="mt-6 text-lg">Weather nearby</h3>
          <p className="text-xs text-ash">
            {nearest.s.name}, about {Math.round(nearest.km)} km away. Context only: weather affects how smoke moves.
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {nearestReadings.map((o) => {
              const d = describeReading(o);
              return (
                <div key={d.metricLabel}>
                  <dt className="text-ash">{d.metricLabel}</dt>
                  <dd>
                    {d.valueText} {o.value === null ? "" : d.scaleLabel}
                    <span className="block text-xs text-dim">{formatObservedAt(o.observedAtUtc, o.countryCode)}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </>
      ) : null}

      {canChart ? (
        <>
          <h3 className="mt-6 text-lg">Last two days</h3>
          {history.status === "loading" ? <LoadingBlock label="Loading recent history" /> : null}
          {history.status === "error" ? (
            <ErrorState title="Recent history is unavailable" onRetry={history.reload}>
              {history.error}
            </ErrorState>
          ) : null}
          {history.status === "ready" ? (
            history.data.observations.length === 0 ? (
              <Note>The source returned no readings for this period.</Note>
            ) : (
              <>
                <TimeSeriesChart
                  height={200}
                  zone={zone}
                  unitLabel={metric.startsWith("index") ? "index" : "µg/m³"}
                  series={[{ id: "v", label: strip?.metricLabel ?? metric, points: history.data.observations.map((o) => ({ t: o.observedAtUtc, v: o.value })) }]}
                  ariaLabel={`${strip?.metricLabel ?? metric} at ${station.name} over the last two days`}
                />
                <ChartTable
                  zone={zone}
                  unitLabel={metric.startsWith("index") ? "index" : "µg/m³"}
                  caption={`Recent readings at ${station.name}`}
                  series={[{ id: "v", label: strip?.metricLabel ?? metric, points: history.data.observations.map((o) => ({ t: o.observedAtUtc, v: o.value })) }]}
                />
                {history.data.failedChunks.length > 0 ? <Note tone="warn">Days that could not be retrieved: {history.data.failedChunks.join(", ")}. They show as gaps.</Note> : null}
              </>
            )
          ) : null}
        </>
      ) : null}

      {provider ? (
        <p className="mt-6 border-t border-line pt-4 text-xs text-ash">
          Source: <a href={provider.homepage}>{provider.operator}</a>. {provider.attribution}{" "}
          {own[0] ? (
            <>
              Retrieved {formatObservedAt(own[0].retrievedAtUtc, station.countryCode)}.{" "}
              <a href={own[0].sourceUrl} rel="noopener noreferrer">
                Raw source
              </a>
              .
            </>
          ) : null}
        </p>
      ) : null}
    </article>
  );
}
