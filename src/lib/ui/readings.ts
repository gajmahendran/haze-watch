import { getCountry, type CountryCode } from "../domain/countries";
import { assessFreshness, type FreshnessAssessment } from "../domain/freshness";
import { categoryFor, INDEX_REGISTRY, sgPm25BandFor } from "../domain/indices";
import { AVERAGING_LABELS, type Observation, type ProviderStatus, type Station } from "../domain/schemas";
import { formatInZone, isKnownTimezone, type KnownTimezone } from "../domain/time";

/**
 * Presentation helpers. Every reading shown in the UI passes through `describeReading`, which
 * always returns the scale or unit and the averaging period alongside the number. There is no
 * helper that returns a bare value.
 */

export type BandLevel = 1 | 2 | 3 | 4 | 5;

export interface ReadingDescription {
  /** "24-hour PSI", "PM2.5, 1-hour mean", "Temperature" */
  metricLabel: string;
  /** Short scale name for the lockup: "Singapore PSI", "µg/m³" */
  scaleLabel: string;
  valueText: string;
  /** Category on the source's own scale, when one is published. */
  band: { label: string; level: BandLevel; scaleName: string } | null;
  isIndex: boolean;
}

export function bandColor(level: BandLevel | null | undefined): string {
  return level ? `var(--color-band-${level})` : "var(--color-band-none)";
}

const WEATHER_LABEL: Record<string, string> = {
  temperature: "Temperature",
  relative_humidity: "Relative humidity",
  wind_speed: "Wind speed",
  wind_direction: "Wind direction",
};

function trimNumber(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10);
}

export function describeReading(o: Observation): ReadingDescription {
  const avg = AVERAGING_LABELS[o.averagingPeriod];
  if (o.kind === "index") {
    const def = INDEX_REGISTRY[o.indexId];
    const band = categoryFor(o.indexId, o.value);
    return {
      metricLabel: `${avg} ${o.indexId === "SG_PSI" ? "PSI" : "API"}`,
      scaleLabel: def.shortName,
      valueText: o.value === null ? "No value" : trimNumber(o.value),
      band: band ? { label: band.label, level: band.level, scaleName: def.shortName } : null,
      isIndex: true,
    };
  }
  if (o.kind === "concentration") {
    const sgBand = sgPm25BandFor({ ...o, countryCode: o.countryCode });
    return {
      metricLabel: `${o.pollutant}, ${avg}${o.averagingPeriod === "P1M" ? "" : " mean"}`,
      scaleLabel: o.unit,
      valueText: o.value === null ? "No value" : trimNumber(o.value),
      band: sgBand ? { label: sgBand.label, level: sgBand.level, scaleName: "NEA 1-hour PM2.5 bands" } : null,
      isIndex: false,
    };
  }
  return {
    metricLabel: WEATHER_LABEL[o.parameter] ?? o.parameter,
    scaleLabel: o.unit,
    valueText: o.value === null ? "No value" : trimNumber(o.value),
    band: null,
    isIndex: false,
  };
}

export function zoneForCountry(code: CountryCode): KnownTimezone {
  const tz = getCountry(code).timezone;
  return isKnownTimezone(tz) ? tz : "UTC";
}

/** "22 Oct 2026, 20:00 SGT (12:00 UTC)" */
export function formatObservedAt(utcIso: string, country: CountryCode): string {
  const local = formatInZone(utcIso, zoneForCountry(country));
  const utc = formatInZone(utcIso, "UTC").split(", ")[1];
  return `${local} (${utc})`;
}

export function freshnessFor(o: Observation, providers: readonly ProviderStatus[], now: Date): FreshnessAssessment {
  const p = providers.find((x) => x.id === o.providerId);
  // Weather and air run on different cadences, so the interval comes from the observation's provider.
  return assessFreshness({ observedAtUtc: o.observedAtUtc, expectedIntervalMinutes: p?.expectedIntervalMinutes ?? null, now });
}

export function stationKindLabel(s: Station): string {
  switch (s.kind) {
    case "station":
      return "Monitoring station";
    case "region_aggregate":
      return "Regional figure (not a single sensor)";
    case "national_aggregate":
      return "National figure";
  }
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/** Map/listing view modes. They never share a colour scale or a ranking. */
export type ViewMode = "index" | "pm25_1h" | "pm25_24h";

export const VIEW_LABELS: Record<ViewMode, string> = {
  index: "National indices",
  pm25_1h: "PM2.5, 1-hour (µg/m³)",
  pm25_24h: "PM2.5, 24-hour (µg/m³)",
};

export function observationForView(observations: readonly Observation[], stationId: string, view: ViewMode): Observation | undefined {
  return observations.find((o) => {
    if (o.stationId !== stationId) return false;
    if (view === "index") return o.kind === "index";
    if (o.kind !== "concentration" || o.pollutant !== "PM2.5") return false;
    return view === "pm25_1h" ? o.averagingPeriod === "PT1H" : o.averagingPeriod === "PT24H";
  });
}
