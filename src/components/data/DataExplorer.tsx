"use client";

import { useMemo, useState } from "react";
import { WHO_2021_GUIDELINES } from "@/lib/domain/indices";
import { AVERAGING_LABELS, type AveragingPeriod, type ProviderStatus, type Station } from "@/lib/domain/schemas";
import { summarise } from "@/lib/domain/stats";
import { formatInZone, localDateKey, type KnownTimezone } from "@/lib/domain/time";
import type { AggregateResponse, HistoryResponse } from "@/lib/pipeline/service";
import type { SeriesDescriptor } from "@/lib/providers/types";
import { useApi, useNow } from "@/lib/ui/useApi";
import { ChartTable, TimeSeriesChart, type ChartReference, type ChartSeries } from "../charts/TimeSeriesChart";
import { DemoBadge } from "../ui/Badge";
import { Button, Segmented, Select } from "../ui/Controls";
import { EmptyState, ErrorState, LoadingBlock, Note } from "../ui/States";

interface CatalogueEntry {
  provider: ProviderStatus;
  stations: Station[];
  zone: KnownTimezone;
  maxHistoryDays: number;
  maxAggregateDays: number;
  historyChunk: "day" | "all" | "range";
  dayConvention: string | null;
  series: SeriesDescriptor[];
}

type Interval = "raw" | "day" | "month";

/** One shape for summary figures, whether computed from raw readings or from server summaries. */
interface Stats {
  count: number;
  missing: number;
  mean: number | null;
  min: number | null;
  max: number | null;
  peakAt: string | null;
}

function seriesKey(s: SeriesDescriptor) {
  return `${s.metricKey}|${s.averagingPeriod}`;
}

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

function apiUrl(p: Record<string, string>) {
  return `/api/history?${new URLSearchParams(p).toString()}`;
}

function statsFromRaw(h: HistoryResponse): Stats {
  const s = summarise(h.observations.map((o) => ({ t: o.observedAtUtc, v: o.value })));
  return { count: s.count, missing: s.missing, mean: s.mean, min: s.min, max: s.max, peakAt: s.peak?.t ?? null };
}

/** Exact overall figures from summaries: the mean is weighted by the number of readings in each bucket. */
function statsFromAggregate(a: AggregateResponse): Stats {
  let count = 0;
  let missing = 0;
  let sum = 0;
  let min: number | null = null;
  let max: number | null = null;
  let peakAt: string | null = null;
  for (const s of a.series) {
    for (const b of s.buckets) {
      count += b.count;
      missing += b.missing;
      if (b.mean !== null) sum += b.mean * b.count;
      if (b.min !== null && (min === null || b.min < min)) min = b.min;
      if (b.max !== null && (max === null || b.max > max)) {
        max = b.max;
        peakAt = b.peakAtUtc;
      }
    }
  }
  return { count, missing, mean: count ? sum / count : null, min, max, peakAt };
}

function fmt(v: number | null) {
  return v === null ? "–" : String(Math.round(v * 10) / 10);
}

function SummaryList({ s, unit, zone }: { s: Stats; unit: string; zone: KnownTimezone }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-3 lg:grid-cols-6">
      <div>
        <dt className="text-ash">Readings</dt>
        <dd className="numeral text-2xl">{s.count.toLocaleString("en-GB")}</dd>
      </div>
      <div>
        <dt className="text-ash">Missing</dt>
        <dd className="numeral text-2xl">{s.missing.toLocaleString("en-GB")}</dd>
      </div>
      <div>
        <dt className="text-ash">Mean ({unit})</dt>
        <dd className="numeral text-2xl">{fmt(s.mean)}</dd>
      </div>
      <div>
        <dt className="text-ash">Lowest</dt>
        <dd className="numeral text-2xl">{fmt(s.min)}</dd>
      </div>
      <div className="col-span-2">
        <dt className="text-ash">Highest single reading</dt>
        <dd>
          <span className="numeral text-2xl">{fmt(s.max)}</span>
          {s.peakAt ? <span className="ml-2 text-ash">{formatInZone(s.peakAt, zone)}</span> : null}
        </dd>
      </div>
    </dl>
  );
}

export function DataExplorer() {
  const cat = useApi<{ catalogue: CatalogueEntry[] }>("/api/history");
  const now = useNow(300_000);
  const [providerId, setProviderId] = useState("");
  const [stationId, setStationId] = useState("");
  const [seriesId, setSeriesId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [interval, setIntervalMode] = useState<Interval>("raw");
  const [chart, setChart] = useState<"line" | "bar">("line");
  const [compare, setCompare] = useState(false);
  const [fromB, setFromB] = useState("");
  const [toB, setToB] = useState("");
  const [request, setRequest] = useState<{ a: string; b: string | null; csv: string; label: string; unit: string; mode: Interval; from: string; to: string } | null>(null);

  const catalogue = cat.data?.catalogue ?? [];
  const entry = catalogue.find((c) => c.provider.id === providerId) ?? catalogue[0];
  const station = entry?.stations.find((s) => s.id === stationId) ?? entry?.stations[0];
  const series = entry?.series.find((s) => seriesKey(s) === seriesId) ?? entry?.series[0];
  const monthly = series?.averagingPeriod === "P1M";
  const archive = entry?.provider.id === "sg-nea-archive";
  const today = now && entry ? localDateKey(now.toISOString(), entry.zone) : null;
  const defaultFrom = monthly ? "2017-01-01" : archive ? "2019-08-01" : today ? addDays(today, -2) : "";
  const defaultTo = monthly ? (today ?? "2026-12-31") : archive ? "2019-10-31" : (today ?? "");
  const effFrom = from || defaultFrom;
  const effTo = to || defaultTo;

  const isRaw = request?.mode === "raw";
  const rawA = useApi<HistoryResponse>(request && isRaw ? request.a : null);
  const rawB = useApi<HistoryResponse>(request && isRaw ? request.b : null);
  const aggA = useApi<AggregateResponse>(request && !isRaw ? request.a : null);
  const aggB = useApi<AggregateResponse>(request && !isRaw ? request.b : null);

  const A = isRaw ? rawA : aggA;
  const B = isRaw ? rawB : aggB;

  const chartSeries: ChartSeries[] = useMemo(() => {
    if (isRaw && rawA.status === "ready") {
      return [{ id: "value", label: request?.label ?? "Value", points: rawA.data.observations.map((o) => ({ t: o.observedAtUtc, v: o.value })) }];
    }
    if (!isRaw && aggA.status === "ready") {
      const buckets = aggA.data.series[0]?.buckets ?? [];
      const word = request?.mode === "day" ? "Daily" : "Monthly";
      return [
        { id: "mean", label: `${word} mean`, points: buckets.map((b) => ({ t: b.key, v: b.mean === null ? null : Math.round(b.mean * 10) / 10 })) },
        { id: "max", label: `${word} highest reading`, points: buckets.map((b) => ({ t: b.key, v: b.max })) },
      ];
    }
    return [];
  }, [isRaw, rawA, aggA, request]);

  if (cat.status === "loading") return <LoadingBlock label="Loading available datasets" className="mt-8" />;
  if (!cat.data) return <ErrorState title="The list of datasets could not be loaded" onRetry={cat.reload}>{cat.error}</ErrorState>;
  if (!entry || !station || !series) return <EmptyState title="No historical datasets are connected">Connect a source with history to use the explorer.</EmptyState>;

  const zone = entry.zone;
  const unit = series.metricKey.startsWith("index") ? "index" : series.unitLabel;
  const span = effFrom && effTo ? daysBetween(effFrom, effTo) : 0;
  const limit = interval === "raw" || monthly ? entry.maxHistoryDays : entry.maxAggregateDays;
  const tooLong = span > limit;

  const run = () => {
    const base: Record<string, string> = { provider: entry.provider.id, station: station.id, metric: series.metricKey, period: series.averagingPeriod };
    const mode: Interval = monthly ? "raw" : interval;
    const agg: Record<string, string> = mode === "raw" ? {} : { aggregate: mode };
    setRequest({
      a: apiUrl({ ...base, ...agg, from: effFrom, to: effTo }),
      b: compare && fromB && toB ? apiUrl({ ...base, ...agg, from: fromB, to: toB }) : null,
      csv: apiUrl({ ...base, ...agg, from: effFrom, to: effTo, format: "csv" }),
      label: `${series.label}, ${station.name}`,
      unit,
      mode,
      from: effFrom,
      to: effTo,
    });
  };

  const refs: ChartReference[] =
    series.metricKey === "concentration:PM2.5" && series.averagingPeriod === "PT24H"
      ? [{ y: WHO_2021_GUIDELINES.pm25.twentyFourHour, label: "WHO 24-hour guideline (99th percentile)" }]
      : series.metricKey === "concentration:PM10" && series.averagingPeriod === "PT24H"
        ? [{ y: WHO_2021_GUIDELINES.pm10.twentyFourHour, label: "WHO 24-hour guideline (99th percentile)" }]
        : [];

  const statsA = isRaw ? (rawA.status === "ready" ? statsFromRaw(rawA.data) : null) : aggA.status === "ready" ? statsFromAggregate(aggA.data) : null;
  const statsB = isRaw ? (rawB.status === "ready" ? statsFromRaw(rawB.data) : null) : aggB.status === "ready" ? statsFromAggregate(aggB.data) : null;
  const demo = A.status === "ready" && A.data.provider.accessMethod === "demo";
  const incomplete = !isRaw && aggA.status === "ready" ? (aggA.data.series[0]?.buckets ?? []).filter((b) => b.incomplete).map((b) => b.key) : [];
  const delta = statsA?.mean != null && statsB?.mean != null ? statsB.mean - statsA.mean : null;

  return (
    <div className="mt-8 space-y-8">
      <form
        className="grid gap-4 rounded-[var(--radius-panel)] border border-line bg-forest p-5 md:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!tooLong) run();
        }}
      >
        <Select label="Source" value={entry.provider.id} onChange={(v) => (setProviderId(v), setStationId(""), setSeriesId(""), setFrom(""), setTo(""), setIntervalMode("raw"))}>
          {catalogue.map((c) => (
            <option key={c.provider.id} value={c.provider.id}>
              {c.provider.name}
            </option>
          ))}
        </Select>
        <Select label="Station or region" value={station.id} onChange={setStationId}>
          {entry.stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select label="Measure" value={seriesKey(series)} onChange={(v) => (setSeriesId(v), setFrom(""), setTo(""), setIntervalMode("raw"))}>
          {entry.series.map((s) => (
            <option key={seriesKey(s)} value={seriesKey(s)}>
              {s.label} ({s.unitLabel})
            </option>
          ))}
        </Select>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="from">
              Start date
            </label>
            <input id="from" type="date" className="field" value={effFrom} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="to">
              End date
            </label>
            <input id="to" type="date" className="field" value={effTo} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <Segmented
          label="Time interval"
          value={monthly ? "raw" : interval}
          onChange={setIntervalMode}
          options={[
            { value: "raw", label: monthly ? "Monthly, as published" : "As published" },
            { value: "day", label: "Daily summary", disabled: monthly },
            { value: "month", label: "Monthly summary", disabled: monthly },
          ]}
        />
        <Segmented label="Chart type" value={chart} onChange={setChart} options={[{ value: "line", label: "Line" }, { value: "bar", label: "Bar" }]} />
        <div className="text-sm">
          <label className="flex items-center gap-2 pt-6">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            Compare with another period
          </label>
        </div>
        {compare ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="field-label" htmlFor="fromB">
                Period B start
              </label>
              <input id="fromB" type="date" className="field" value={fromB} onChange={(e) => setFromB(e.target.value)} />
            </div>
            <div>
              <label className="field-label" htmlFor="toB">
                Period B end
              </label>
              <input id="toB" type="date" className="field" value={toB} onChange={(e) => setToB(e.target.value)} />
            </div>
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-wrap items-center gap-4 md:col-span-2 lg:col-span-4">
          <Button type="submit" variant="primary" disabled={tooLong}>
            Show data
          </Button>
          <p className={`text-xs measure ${tooLong ? "text-warn" : "text-ash"}`}>
            {tooLong
              ? `This range is ${span.toLocaleString("en-GB")} days. ${interval === "raw" ? `Readings as published are limited to ${limit} days per request; choose a daily or monthly summary for longer ranges.` : `Summaries are limited to ${limit.toLocaleString("en-GB")} days.`}`
              : entry.historyChunk === "day"
                ? `Readings as published: up to ${entry.maxHistoryDays} days per request, because each day is a separate call to the source.`
                : archive
                  ? "Hourly archive since April 2014. Readings as published up to a year at a time; summaries across the whole archive."
                  : "The full series is fetched once and filtered here."}{" "}
            Averaging period of the source: {AVERAGING_LABELS[series.averagingPeriod as AveragingPeriod]}. Times in {zone}.
          </p>
        </div>
      </form>

      {!request ? (
        <EmptyState title="Choose a series and select Show data">
          Results include a chart, a summary, the data table and a CSV download with original values and metadata.
          {archive ? " The default range covers the 2019 haze." : ""}
        </EmptyState>
      ) : null}
      {request && A.status === "loading" ? <LoadingBlock label="Loading readings from the source" /> : null}
      {request && A.status === "error" ? <ErrorState title="These readings could not be retrieved">{A.error}</ErrorState> : null}

      {request && A.status === "ready" ? (
        <section aria-labelledby="result-heading" className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="result-heading" className="text-2xl">
              {request.label}
            </h2>
            {demo ? <DemoBadge /> : null}
          </div>
          <p className="text-sm text-ash">
            {request.from} to {request.to}
            {request.mode !== "raw" ? `, ${request.mode === "day" ? "daily" : "monthly"} summaries` : ""}. Source: {A.data.provider.operator}.
            {!isRaw && aggA.status === "ready" ? ` ${aggA.data.dayConvention}` : ""}
          </p>
          {A.data.warnings.map((w) => (
            <Note key={w} tone="warn">
              {w}
            </Note>
          ))}
          {!statsA || statsA.count + statsA.missing === 0 ? (
            <EmptyState title="No readings in this range">The source has nothing for these dates.</EmptyState>
          ) : (
            <>
              <SummaryList s={statsA} unit={request.unit} zone={zone} />
              <TimeSeriesChart
                series={chartSeries}
                zone={zone}
                unitLabel={request.unit}
                kind={chart}
                references={refs}
                tickFormat={isRaw ? (monthly ? "month" : "datetime") : "raw"}
                ariaLabel={`${request.label}, ${request.from} to ${request.to}`}
              />
              {incomplete.length > 0 ? (
                <Note tone="warn">
                  {incomplete.length} {request.mode === "day" ? "day(s)" : "month(s)"} have fewer than 75 percent of the expected hourly readings
                  {incomplete.length <= 12 ? `: ${incomplete.join(", ")}` : ""}. Their figures are shown but should be read with care.
                </Note>
              ) : null}
              {refs.length > 0 ? <Note>{WHO_2021_GUIDELINES.twentyFourHourNote} WHO guideline levels are health guidance, not legal limits.</Note> : null}
              <ChartTable series={chartSeries} zone={zone} unitLabel={request.unit} caption={request.label} />
              <a
                href={request.csv}
                className="inline-flex min-h-10 items-center rounded-[var(--radius-control)] border border-line-strong px-4 text-sm font-semibold text-smoke no-underline hover:border-ash"
              >
                Download {isRaw ? "readings" : `${request.mode === "day" ? "daily" : "monthly"} summary`} (CSV)
              </a>
            </>
          )}
        </section>
      ) : null}

      {request?.b && statsA && statsB ? (
        <section aria-labelledby="compare-heading" className="border-t border-line pt-6">
          <h2 id="compare-heading" className="text-2xl">
            Period comparison
          </h2>
          <p className="mt-1 text-sm text-ash">
            Same station, measure and averaging period. Period A is {request.from} to {request.to}; period B is {fromB} to {toB}. Means are over
            all readings in each period.
          </p>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-ash">Mean, period A</dt>
              <dd className="numeral text-3xl">{fmt(statsA.mean)}</dd>
            </div>
            <div>
              <dt className="text-ash">Mean, period B</dt>
              <dd className="numeral text-3xl">{fmt(statsB.mean)}</dd>
            </div>
            <div>
              <dt className="text-ash">Change, B minus A</dt>
              <dd className="numeral text-3xl">
                {delta === null ? "–" : `${delta > 0 ? "+" : ""}${fmt(delta)}`}
                {delta !== null && statsA.mean ? <span className="ml-2 text-lg text-ash">({Math.round((delta / statsA.mean) * 100)}%)</span> : null}
              </dd>
            </div>
          </dl>
          {[statsA, statsB].map((s, i) =>
            s.count + s.missing > 0 && s.missing / (s.count + s.missing) > 0.25 ? (
              <Note key={i} tone="warn">
                Period {i === 0 ? "A" : "B"} is missing {s.missing.toLocaleString("en-GB")} of {(s.count + s.missing).toLocaleString("en-GB")} readings.
              </Note>
            ) : null,
          )}
        </section>
      ) : request?.b && B.status === "error" ? (
        <ErrorState title="Period B could not be retrieved">{B.error}</ErrorState>
      ) : null}
    </div>
  );
}
