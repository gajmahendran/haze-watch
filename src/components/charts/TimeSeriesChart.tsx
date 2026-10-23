"use client";

import { CartesianGrid, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar, BarChart } from "recharts";
import { formatInZone, type KnownTimezone } from "@/lib/domain/time";

/**
 * Line or bar chart for one metric on one scale. Callers pass series that already share a unit and
 * averaging period: the chart has a single y axis and a single unit label by design.
 *
 * Missing values are `null` and render as gaps. Nothing is interpolated.
 */

export interface ChartSeries {
  id: string;
  label: string;
  /** Only for series that represent an air-quality band; everything else uses neutral series colours. */
  color?: string;
  points: { t: string; v: number | null }[];
}

export interface ChartReference {
  y: number;
  label: string;
}

// Distinguishable line colours that do not reuse the air-quality band colours.
const SERIES_COLOURS = ["#d6e9da", "#8fb8c9", "#c9b48f", "#a3a8d9", "#9fd1b4", "#d9a3c2", "#b8c9a3"];

export function seriesColour(i: number): string {
  return SERIES_COLOURS[i % SERIES_COLOURS.length]!;
}

function pivot(series: ChartSeries[]): Record<string, number | string | null>[] {
  const rows = new Map<string, Record<string, number | string | null>>();
  for (const s of series) {
    for (const p of s.points) {
      const row = rows.get(p.t) ?? { t: p.t };
      row[s.id] = p.v;
      rows.set(p.t, row);
    }
  }
  return [...rows.values()].sort((a, b) => (String(a.t) < String(b.t) ? -1 : 1));
}

export function TimeSeriesChart({
  series,
  unitLabel,
  zone,
  references = [],
  kind = "line",
  height = 300,
  tickFormat = "datetime",
  ariaLabel,
}: {
  series: ChartSeries[];
  unitLabel: string;
  zone: KnownTimezone;
  references?: ChartReference[];
  kind?: "line" | "bar";
  height?: number;
  tickFormat?: "datetime" | "date" | "month" | "raw";
  ariaLabel: string;
}) {
  const data = pivot(series);
  const fmt = (t: string) => {
    if (tickFormat === "raw") return t;
    if (!/T/.test(t)) return t;
    const s = formatInZone(t, zone);
    if (tickFormat === "date") return s.split(",")[0]!;
    if (tickFormat === "month") return s.split(" ").slice(1, 3).join(" ").replace(",", "");
    const [date, time] = s.split(", ");
    return `${date!.split(" ").slice(0, 2).join(" ")} ${time!.slice(0, 5)}`;
  };
  const common = (
    <>
      <CartesianGrid stroke="#2f4338" strokeDasharray="2 4" vertical={false} />
      <XAxis dataKey="t" tickFormatter={fmt} stroke="#8e9a91" tick={{ fontSize: 12 }} minTickGap={36} />
      <YAxis
        stroke="#8e9a91"
        tick={{ fontSize: 12 }}
        width={52}
        label={{ value: unitLabel, angle: -90, position: "insideLeft", fill: "#a9b2aa", fontSize: 12, dx: -2 }}
      />
      <Tooltip
        contentStyle={{ background: "#1f3128", border: "1px solid #46604f", borderRadius: 6, color: "#e4e1d8" }}
        labelFormatter={(t) => (typeof t === "string" ? (/T/.test(t) ? formatInZone(t, zone) : t) : String(t))}
        formatter={(v, name) => [v === null || v === undefined ? "No value" : `${v} ${unitLabel}`, name]}
      />
      {series.length > 1 ? <Legend wrapperStyle={{ fontSize: 13 }} /> : null}
      {references.map((r) => (
        <ReferenceLine key={r.label} y={r.y} stroke="#a9b2aa" strokeDasharray="6 4" label={{ value: r.label, fill: "#a9b2aa", fontSize: 11, position: "insideTopRight" }} />
      ))}
    </>
  );

  return (
    <div role="img" aria-label={ariaLabel} style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {kind === "bar" ? (
          <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            {common}
            {series.map((s, i) => (
              <Bar key={s.id} dataKey={s.id} name={s.label} fill={s.color ?? seriesColour(i)} isAnimationActive={false} />
            ))}
          </BarChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            {common}
            {series.map((s, i) => (
              <Line
                key={s.id}
                type="monotone"
                dataKey={s.id}
                name={s.label}
                stroke={s.color ?? seriesColour(i)}
                strokeWidth={1.8}
                dot={data.length < 40 ? { r: 2 } : false}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** Accessible table alternative for any chart. Missing values show as "No value". */
export function ChartTable({ series, unitLabel, zone, caption }: { series: ChartSeries[]; unitLabel: string; zone: KnownTimezone; caption: string }) {
  const rows = pivot(series);
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-lichen">Show the data as a table</summary>
      <div className="mt-2 max-h-80 overflow-auto" tabIndex={0} role="region" aria-label={`Data table: ${caption}`}>
        <table className="data-table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Time</th>
              {series.map((s) => (
                <th key={s.id} scope="col" className="num">
                  {s.label} ({unitLabel})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.t)}>
                <td>{typeof r.t === "string" && /T/.test(r.t) ? formatInZone(r.t, zone) : String(r.t)}</td>
                {series.map((s) => (
                  <td key={s.id} className="num">
                    {r[s.id] === null || r[s.id] === undefined ? <span className="text-dim">No value</span> : String(r[s.id])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
