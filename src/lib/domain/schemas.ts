import { z } from "zod";
import { COUNTRY_CODES } from "./countries";
import { INDEX_IDS } from "./indices";

/**
 * Canonical data model. Every provider adapter validates its raw payload and then emits objects
 * that conform to these schemas. The UI only ever sees these shapes, never a provider's raw format.
 *
 * Missing is `null`. It is never coerced to 0.
 */

export const countryCodeSchema = z.enum(COUNTRY_CODES);
export const indexIdSchema = z.enum(INDEX_IDS);
export const utcIsoSchema = z.iso.datetime();

export const AVERAGING_PERIODS = ["PT0S", "PT1M", "PT10M", "PT1H", "PT3H", "PT8H", "PT24H", "P1M"] as const;
export type AveragingPeriod = (typeof AVERAGING_PERIODS)[number];
export const averagingPeriodSchema = z.enum(AVERAGING_PERIODS);
export const AVERAGING_LABELS: Record<AveragingPeriod, string> = {
  PT0S: "instantaneous",
  PT1M: "1-minute",
  PT10M: "10-minute",
  PT1H: "1-hour",
  PT3H: "3-hour",
  PT8H: "8-hour",
  PT24H: "24-hour",
  P1M: "monthly mean",
};

export const POLLUTANTS = ["PM2.5", "PM10", "O3", "NO2", "SO2", "CO"] as const;
export type Pollutant = (typeof POLLUTANTS)[number];
export const CONCENTRATION_UNITS = ["µg/m³", "mg/m³", "ppm", "ppb"] as const;
export type ConcentrationUnit = (typeof CONCENTRATION_UNITS)[number];

export const WEATHER_PARAMETERS = ["temperature", "relative_humidity", "wind_speed", "wind_direction"] as const;
export type WeatherParameter = (typeof WEATHER_PARAMETERS)[number];
export const WEATHER_UNITS = ["°C", "%", "m/s", "°"] as const;

export const OBSERVATION_QUALITY = ["unvalidated", "validated", "estimated", "flagged"] as const;
export type ObservationQuality = (typeof OBSERVATION_QUALITY)[number];

/** `provider` = came from a real external source. `demo` = synthetic development fixture. */
export const PROVENANCE = ["provider", "demo"] as const;
export type Provenance = (typeof PROVENANCE)[number];

export const stationSchema = z.object({
  /** Globally unique: `${providerId}:${externalId}` */
  id: z.string().min(1),
  providerId: z.string().min(1),
  externalId: z.string().min(1),
  name: z.string().min(1),
  countryCode: countryCodeSchema,
  /**
   * `station` = a physical monitoring station.
   * `region_aggregate` = a regional figure published by an agency (e.g. Singapore's "north" region),
   * positioned at the agency's label location. It is not a sensor and must be labelled as a region.
   * `national_aggregate` = a country-wide figure (e.g. a national monthly mean). It has no location.
   */
  kind: z.enum(["station", "region_aggregate", "national_aggregate"]),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  area: z.string().nullable(),
});
export type Station = z.infer<typeof stationSchema>;

/** The value exactly as the source supplied it, kept separate from our normalised value. */
const originalSchema = z.object({
  value: z.union([z.number(), z.string()]).nullable(),
  unit: z.string().nullable(),
  timestamp: z.string().min(1),
  timezone: z.string().min(1),
});

const observationBase = z.object({
  providerId: z.string().min(1),
  stationId: z.string().min(1),
  countryCode: countryCodeSchema,
  observedAtUtc: utcIsoSchema,
  retrievedAtUtc: utcIsoSchema,
  original: originalSchema,
  quality: z.enum(OBSERVATION_QUALITY),
  provenance: z.enum(PROVENANCE),
  sourceUrl: z.url(),
});

export const concentrationObservationSchema = observationBase.extend({
  kind: z.literal("concentration"),
  pollutant: z.enum(POLLUTANTS),
  /** `null` means no value was reported. It never means zero. */
  value: z.number().nonnegative().nullable(),
  unit: z.enum(CONCENTRATION_UNITS),
  averagingPeriod: averagingPeriodSchema,
});

export const indexObservationSchema = observationBase.extend({
  kind: z.literal("index"),
  indexId: indexIdSchema,
  value: z.number().nonnegative().nullable(),
  averagingPeriod: averagingPeriodSchema,
  dominantPollutant: z.string().nullable(),
});

export const weatherObservationSchema = observationBase.extend({
  kind: z.literal("weather"),
  parameter: z.enum(WEATHER_PARAMETERS),
  value: z.number().nullable(),
  unit: z.enum(WEATHER_UNITS),
  averagingPeriod: averagingPeriodSchema,
});

export const observationSchema = z.discriminatedUnion("kind", [
  concentrationObservationSchema,
  indexObservationSchema,
  weatherObservationSchema,
]);

export type ConcentrationObservation = z.infer<typeof concentrationObservationSchema>;
export type IndexObservation = z.infer<typeof indexObservationSchema>;
export type WeatherObservation = z.infer<typeof weatherObservationSchema>;
export type Observation = z.infer<typeof observationSchema>;

/** The measured quantity an observation describes, without its value or time. */
export function metricOf(o: Observation): string {
  switch (o.kind) {
    case "index":
      return o.indexId;
    case "concentration":
      return o.pollutant;
    case "weather":
      return o.parameter;
  }
}

/**
 * Natural key used for deduplication. Re-ingesting the same payload must never create a second row,
 * so this key mirrors the unique constraints in the database migration.
 */
export function observationKey(o: Observation): string {
  return [o.providerId, o.stationId, o.observedAtUtc, o.kind, metricOf(o), o.averagingPeriod].join("|");
}

/** Key for "latest reading of this metric at this station". Excludes the timestamp. */
export function seriesKey(o: Observation): string {
  return [o.providerId, o.stationId, o.kind, metricOf(o), o.averagingPeriod].join("|");
}

/** Hotspots are satellite thermal anomalies. They are not confirmed fires and carry no cause. */
export const hotspotSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  kind: z.literal("satellite_thermal_anomaly"),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  acquiredAtUtc: utcIsoSchema,
  satellite: z.string().nullable(),
  instrument: z.string().nullable(),
  /** Raw confidence exactly as supplied. VIIRS reports categories (low/nominal/high); MODIS reports 0-100. */
  confidenceRaw: z.string().nullable(),
  confidenceScale: z.enum(["categorical", "percent", "unknown"]),
  frpMegawatts: z.number().nonnegative().nullable(),
  dayNight: z.enum(["D", "N"]).nullable(),
  /**
   * Country whose mapped land boundary contains the point, from Natural Earth polygons. `null` when
   * the point falls outside every covered boundary (offshore, coarse coastline, or another country).
   * This is a geographic label only. It says nothing about who or what caused the detection.
   */
  countryCode: countryCodeSchema.nullable(),
  retrievedAtUtc: utcIsoSchema,
  provenance: z.enum(PROVENANCE),
  sourceUrl: z.url(),
});
export type Hotspot = z.infer<typeof hotspotSchema>;

export const providerConnectionSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("connected") }),
  z.object({
    status: z.literal("not_connected"),
    reason: z.enum(["missing_credentials", "no_documented_access", "not_implemented", "development_only"]),
    detail: z.string(),
  }),
]);
export type ProviderConnection = z.infer<typeof providerConnectionSchema>;

export const ingestionLogSchema = z.object({
  id: z.string().min(1),
  providerId: z.string().min(1),
  startedAtUtc: utcIsoSchema,
  finishedAtUtc: utcIsoSchema,
  status: z.enum(["success", "partial", "failed", "skipped"]),
  httpStatus: z.number().int().nullable(),
  stationsSeen: z.number().int().nonnegative(),
  inserted: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  conflicts: z.number().int().nonnegative(),
  invalidItems: z.number().int().nonnegative(),
  attempts: z.number().int().nonnegative(),
  message: z.string().nullable(),
});
export type IngestionLog = z.infer<typeof ingestionLogSchema>;

export const providerStatusSchema = z.object({
  id: z.string(),
  name: z.string(),
  operator: z.string(),
  homepage: z.url(),
  docsUrl: z.url(),
  licence: z.string(),
  attribution: z.string(),
  countries: z.array(countryCodeSchema),
  /** What the provider feeds: latest readings, long-run history, or satellite hotspots. */
  role: z.enum(["live", "historical", "hotspots"]),
  accessMethod: z.enum(["documented_api", "public_download", "credentials_required", "web_only", "demo"]),
  expectedIntervalMinutes: z.number().positive().nullable(),
  intervalNote: z.string().nullable(),
  connection: providerConnectionSchema,
  lastIngestion: ingestionLogSchema.nullable(),
});
export type ProviderStatus = z.infer<typeof providerStatusSchema>;

export const snapshotSchema = z.object({
  generatedAtUtc: utcIsoSchema,
  /** True only when the explicit development demo flag is on. Never true in production. */
  demoMode: z.boolean(),
  providers: z.array(providerStatusSchema),
  stations: z.array(stationSchema),
  /** Latest observation per series. */
  observations: z.array(observationSchema),
  warnings: z.array(z.string()),
});

export const hotspotResponseSchema = z.object({
  generatedAtUtc: utcIsoSchema,
  demoMode: z.boolean(),
  provider: providerStatusSchema,
  windowDays: z.number().int().positive(),
  /** Detections returned to the client after filters and the display cap. */
  hotspots: z.array(hotspotSchema),
  /** Total matching detections before the display cap. */
  totalMatching: z.number().int().nonnegative(),
  truncated: z.boolean(),
  /** Daily detection counts (UTC date of acquisition) for matching detections. */
  daily: z.array(z.object({ date: z.iso.date(), count: z.number().int().nonnegative() })),
  latestAcquiredAtUtc: utcIsoSchema.nullable(),
  warnings: z.array(z.string()),
});
export type HotspotResponse = z.infer<typeof hotspotResponseSchema>;
export type Snapshot = z.infer<typeof snapshotSchema>;
