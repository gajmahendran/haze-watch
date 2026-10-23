import { metricOf, type Observation, type Station } from "./schemas";

/**
 * CSV export (RFC 4180).
 *  - Missing values export as empty cells, never 0.
 *  - Original source values, timezone and provenance are preserved as separate columns.
 *  - Text cells that begin with a spreadsheet formula character are neutralised so an exported file
 *    cannot execute a formula when opened in Excel or Sheets (CSV injection).
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

const FORMULA_LEADERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function escapeCsvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";

  let text = value;
  if (text.length > 0 && FORMULA_LEADERS.has(text[0] as string)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text !== text.trim()) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[], options: { bom?: boolean } = {}): string {
  const lines = [columns.map((c) => escapeCsvCell(c.header)).join(",")];
  for (const row of rows) lines.push(columns.map((c) => escapeCsvCell(c.value(row))).join(","));
  const body = lines.join("\r\n") + "\r\n";
  return options.bom ? `﻿${body}` : body;
}

export interface ObservationExportRow {
  observation: Observation;
  station: Station | undefined;
}

function unitOf(o: Observation): string | null {
  if (o.kind === "index") return null;
  return o.unit;
}

export const OBSERVATION_CSV_COLUMNS: readonly CsvColumn<ObservationExportRow>[] = [
  { header: "provider_id", value: (r) => r.observation.providerId },
  { header: "station_id", value: (r) => r.observation.stationId },
  { header: "station_name", value: (r) => r.station?.name },
  { header: "station_kind", value: (r) => r.station?.kind },
  { header: "country", value: (r) => r.observation.countryCode },
  { header: "latitude", value: (r) => r.station?.latitude },
  { header: "longitude", value: (r) => r.station?.longitude },
  { header: "kind", value: (r) => r.observation.kind },
  { header: "metric", value: (r) => metricOf(r.observation) },
  { header: "value", value: (r) => r.observation.value },
  { header: "unit", value: (r) => unitOf(r.observation) },
  { header: "averaging_period", value: (r) => r.observation.averagingPeriod },
  { header: "observed_at_utc", value: (r) => r.observation.observedAtUtc },
  { header: "source_timestamp", value: (r) => r.observation.original.timestamp },
  { header: "source_timezone", value: (r) => r.observation.original.timezone },
  { header: "original_value", value: (r) => r.observation.original.value },
  { header: "original_unit", value: (r) => r.observation.original.unit },
  { header: "quality", value: (r) => r.observation.quality },
  { header: "provenance", value: (r) => r.observation.provenance },
  { header: "retrieved_at_utc", value: (r) => r.observation.retrievedAtUtc },
  { header: "source_url", value: (r) => r.observation.sourceUrl },
];

export function observationsToCsv(
  observations: readonly Observation[],
  stations: ReadonlyMap<string, Station>,
  options: { bom?: boolean } = {},
): string {
  const rows = observations.map((observation) => ({ observation, station: stations.get(observation.stationId) }));
  return toCsv(rows, OBSERVATION_CSV_COLUMNS, options);
}

/** Safe filename. Demo data is prefixed so an export can never be mistaken for real readings. */
export function exportFilename(parts: { scope: string; from?: string; to?: string; demo: boolean }): string {
  const slug = parts.scope.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "export";
  const range = parts.from && parts.to ? `_${parts.from}_to_${parts.to}` : "";
  return `${parts.demo ? "DEMO-" : ""}haze-watch_${slug}${range}.csv`;
}
