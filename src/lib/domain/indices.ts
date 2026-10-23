/**
 * National air-quality index registry.
 *
 * INTEGRITY RULE: an index value is only meaningful on its own scale. Singapore's PSI and
 * Malaysia's API share band names ("Good", "Moderate", ...) and similar numeric ranges, but they
 * are computed by different agencies with different methodologies. Nothing in this codebase may
 * treat a PSI value and an API value as the same quantity. Every function that combines or
 * compares index values goes through `assertComparable`, which throws on mixed scales.
 *
 * Band thresholds were checked against sources opened on 2026-10-23:
 *  - Singapore PSI: Ministry of Health "Haze" page and NEA's July 2024 haze advisory, both of which
 *    give 0-50 Good, 51-100 Moderate, 101-200 Unhealthy, 201-300 Very Unhealthy, above 300 Hazardous
 *    for the 24-hour PSI.
 *  - Malaysia API: the DOE methodology page embeds a flipbook that could not be machine-read. The
 *    bands below match the DOE scale as quoted by RTM (Radio Televisyen Malaysia, a government
 *    broadcaster) on 16 September 2026. `bandsVerifiedAgainstSource` stays false for Malaysia until
 *    someone confirms them against a DOE document directly.
 */

export const INDEX_IDS = ["SG_PSI", "MY_API"] as const;
export type IndexId = (typeof INDEX_IDS)[number];

export interface IndexBand {
  /** Inclusive upper bound of the band. `null` means open ended. */
  readonly upTo: number | null;
  readonly label: string;
  /** 1 (best) to 5 (worst). Used only for restrained status styling, never for cross-index ranking. */
  readonly level: 1 | 2 | 3 | 4 | 5;
}

export interface IndexDefinition {
  readonly id: IndexId;
  /** Short label that must always accompany a value in the UI, e.g. "Singapore PSI". */
  readonly shortName: string;
  readonly fullName: string;
  readonly countryCode: "SG" | "MY";
  /** Local-language name, where the agency uses one. */
  readonly localName: string | null;
  readonly agency: string;
  readonly referenceUrl: string;
  readonly scaleNote: string;
  readonly bands: readonly IndexBand[];
  readonly bandsVerifiedAgainstSource: boolean;
  readonly bandsNote: string;
  readonly bandsSourceUrls: readonly string[];
  /** Averaging period the official categories apply to. */
  readonly categoryAveraging: string;
}

const STANDARD_BAND_SHAPE: readonly IndexBand[] = [
  { upTo: 50, label: "Good", level: 1 },
  { upTo: 100, label: "Moderate", level: 2 },
  { upTo: 200, label: "Unhealthy", level: 3 },
  { upTo: 300, label: "Very unhealthy", level: 4 },
  { upTo: null, label: "Hazardous", level: 5 },
];

export const INDEX_REGISTRY: Readonly<Record<IndexId, IndexDefinition>> = {
  SG_PSI: {
    id: "SG_PSI",
    shortName: "Singapore PSI",
    fullName: "Pollutant Standards Index (Singapore, National Environment Agency)",
    countryCode: "SG",
    localName: null,
    agency: "National Environment Agency (NEA)",
    referenceUrl: "https://www.haze.gov.sg/resources/historical-readings",
    scaleNote:
      "Singapore's PSI is reported by NEA, including a 24-hour PSI by region. It is not interchangeable with Malaysia's API or any AQI.",
    bands: STANDARD_BAND_SHAPE,
    bandsVerifiedAgainstSource: true,
    bandsNote:
      "Categories as published by Singapore's Ministry of Health and NEA for the 24-hour PSI. Health advice in Singapore is tied to these categories and to the 1-hour PM2.5 bands.",
    bandsSourceUrls: [
      "https://www.moh.gov.sg/others/haze/",
      "https://isomer-user-content.by.gov.sg/46/4cac521a-0f04-439c-aae9-2c05044164a1/NEA%20Advisory_How%20to%20Plan%20Your%20Outdoor%20Activities%20During%20Haze_English%20version_July%202024.pdf",
    ],
    categoryAveraging: "24-hour",
  },
  MY_API: {
    id: "MY_API",
    shortName: "Malaysia API",
    fullName: "Air Pollutant Index, Indeks Pencemar Udara (Malaysia, Department of Environment)",
    countryCode: "MY",
    localName: "Indeks Pencemar Udara (IPU)",
    agency: "Department of Environment Malaysia (DOE)",
    referenceUrl: "https://www.doe.gov.my/pengurusan-udara/api/",
    scaleNote:
      "Malaysia's API is calculated by the DOE using its own methodology. It is not interchangeable with Singapore's PSI or any AQI.",
    bands: STANDARD_BAND_SHAPE,
    bandsVerifiedAgainstSource: false,
    bandsNote:
      "Categories as quoted by RTM from the DOE scale (Baik, Sederhana, Tidak Sihat, Sangat Tidak Sihat, Berbahaya). DOE's 2000 guide (fourth edition) gives the same bands, with 301 to 500 as Hazardous and above 500 as Emergency, but the current edition has not been seen, so the labels stay provisional. The API is the highest of six sub-indices: 24 hours for PM2.5 and PM10, 8 hours for CO, 1 hour for ozone and NO2.",
    bandsSourceUrls: [
      "https://berita.rtm.gov.my/nasional/senarai-berita-nasional/senarai-artikel/38-kawasan-di-semenanjung-malaysia-catat-ipu-tidak-sihat-petang-ini/",
      "https://www.doe.gov.my/en/api-2/",
      "https://www.europasia.com.my/wp-content/uploads/2018/10/Air-Pollutant-Index-DOE.pdf",
      "https://www.malaysiakini.com/news/493169",
    ],
    categoryAveraging: "hourly API; highest sub-index, each with its own averaging period",
  },
};

export class IncompatibleIndexError extends Error {
  readonly left: IndexId;
  readonly right: IndexId;
  constructor(left: IndexId, right: IndexId) {
    super(
      `Refusing to compare ${INDEX_REGISTRY[left].shortName} with ${INDEX_REGISTRY[right].shortName}: national indices use different methodologies and are not interchangeable.`,
    );
    this.name = "IncompatibleIndexError";
    this.left = left;
    this.right = right;
  }
}

export class IncompatibleConcentrationError extends Error {
  constructor(reason: string) {
    super(`Refusing to compare concentrations: ${reason}`);
    this.name = "IncompatibleConcentrationError";
  }
}

export function isIndexId(value: unknown): value is IndexId {
  return typeof value === "string" && (INDEX_IDS as readonly string[]).includes(value);
}

export function getIndex(id: IndexId): IndexDefinition {
  return INDEX_REGISTRY[id];
}

/** Throws unless both values are on the same national index. */
export function assertComparable(a: { indexId: IndexId }, b: { indexId: IndexId }): void {
  if (a.indexId !== b.indexId) throw new IncompatibleIndexError(a.indexId, b.indexId);
}

/** Looks up the category band for a value on a given index. Returns null for missing/invalid values. */
export function categoryFor(indexId: IndexId, value: number | null): IndexBand | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const { bands } = INDEX_REGISTRY[indexId];
  return bands.find((band) => band.upTo === null || value <= band.upTo) ?? null;
}

/**
 * Formats a reading so the scale is always named. Never print a bare number or a bare category:
 * "Unhealthy" means different things on different scales.
 */
export function formatIndexReading(reading: { indexId: IndexId; value: number | null }): string {
  const def = INDEX_REGISTRY[reading.indexId];
  if (reading.value === null) return `${def.shortName}: no value reported`;
  const band = categoryFor(reading.indexId, reading.value);
  return band
    ? `${def.shortName} ${reading.value} (${band.label})`
    : `${def.shortName} ${reading.value}`;
}

/** Compares two readings on the same index. Throws on mixed scales. Nulls sort last. */
export function compareIndexReadings(
  a: { indexId: IndexId; value: number | null },
  b: { indexId: IndexId; value: number | null },
): number {
  assertComparable(a, b);
  if (a.value === null && b.value === null) return 0;
  if (a.value === null) return 1;
  if (b.value === null) return -1;
  return a.value - b.value;
}

/** Ranks readings from highest to lowest. Throws if more than one index is present. */
export function rankIndexReadings<T extends { indexId: IndexId; value: number | null }>(
  readings: readonly T[],
): T[] {
  const first = readings[0];
  if (!first) return [];
  for (const r of readings) assertComparable(first, r);
  // Highest first; missing values always last (reversing the comparator would put them first).
  return [...readings].sort((a, b) => {
    if (a.value === null || b.value === null) return compareIndexReadings(a, b);
    return b.value - a.value;
  });
}

/** Groups readings by index so UIs render one list per scale instead of one mixed list. */
export function groupByIndex<T extends { indexId: IndexId }>(
  readings: readonly T[],
): Map<IndexId, T[]> {
  const groups = new Map<IndexId, T[]>();
  for (const reading of readings) {
    const existing = groups.get(reading.indexId);
    if (existing) existing.push(reading);
    else groups.set(reading.indexId, [reading]);
  }
  return groups;
}

export interface ConcentrationLike {
  pollutant: string;
  unit: string;
  averagingPeriod: string;
  value: number | null;
}

/**
 * Concentrations are only comparable when pollutant, unit and averaging period all match.
 * A 1-hour PM2.5 reading and a 24-hour PM2.5 reading are different quantities.
 */
export function assertComparableConcentrations(a: ConcentrationLike, b: ConcentrationLike): void {
  if (a.pollutant !== b.pollutant) {
    throw new IncompatibleConcentrationError(`pollutants differ (${a.pollutant} vs ${b.pollutant}).`);
  }
  if (a.unit !== b.unit) {
    throw new IncompatibleConcentrationError(`units differ (${a.unit} vs ${b.unit}). Convert explicitly first.`);
  }
  if (a.averagingPeriod !== b.averagingPeriod) {
    throw new IncompatibleConcentrationError(
      `averaging periods differ (${a.averagingPeriod} vs ${b.averagingPeriod}).`,
    );
  }
}

/**
 * WHO 2021 global air quality guideline values for PM2.5 and PM10 (µg/m³), used only as clearly
 * labelled reference lines on charts. They are health guidance, not national legal standards.
 * WHO's own pages give these values only in images; they were checked on 2026-10-23 against the
 * WHO table as reproduced by DieselNet (https://dieselnet.com/news/2021/09who.php). The 24-hour
 * values are 99th percentiles (3 to 4 exceedance days a year), so a single day above them is not
 * by itself a breach of the guideline.
 */
export const WHO_2021_GUIDELINES = {
  source: "WHO global air quality guidelines 2021",
  sourceUrl: "https://www.who.int/publications/i/item/9789240034228",
  pm25: { annual: 5, twentyFourHour: 15 },
  pm10: { annual: 15, twentyFourHour: 45 },
  unit: "µg/m³",
  twentyFourHourNote: "24-hour guideline levels are 99th percentiles (3 to 4 exceedance days per year).",
} as const;

/**
 * Singapore's 1-hour PM2.5 bands. These are a concentration guide published by NEA and MOH for
 * "the next hour" activity decisions. They are NOT an index and never share a scale with the PSI.
 */
export interface ConcentrationBand {
  readonly upTo: number | null;
  readonly label: string;
  readonly level: 1 | 2 | 3 | 4;
}

export const SG_PM25_1H_GUIDE = {
  id: "SG_PM25_1H_BANDS",
  name: "NEA 1-hour PM2.5 bands",
  pollutant: "PM2.5",
  unit: "µg/m³",
  averagingPeriod: "PT1H",
  countryCode: "SG",
  bands: [
    { upTo: 55, label: "Band 1 (Normal)", level: 1 },
    { upTo: 150, label: "Band 2 (Elevated)", level: 2 },
    { upTo: 250, label: "Band 3 (High)", level: 3 },
    { upTo: null, label: "Band 4 (Very High)", level: 4 },
  ] as readonly ConcentrationBand[],
  sourceUrl: "https://www.moh.gov.sg/others/haze/",
  note: "Applies to Singapore's 1-hour PM2.5 readings only. Bands are integers in µg/m³; Band 2 starts at 56.",
} as const;

/** Band for a 1-hour PM2.5 value in Singapore. Only valid for 1-hour PM2.5 in µg/m³. */
export function sgPm25BandFor(
  reading: { pollutant: string; unit: string; averagingPeriod: string; countryCode: string; value: number | null },
): ConcentrationBand | null {
  if (
    reading.pollutant !== "PM2.5" ||
    reading.unit !== "µg/m³" ||
    reading.averagingPeriod !== "PT1H" ||
    reading.countryCode !== "SG"
  ) {
    return null;
  }
  const v = reading.value;
  if (v === null || !Number.isFinite(v) || v < 0) return null;
  return SG_PM25_1H_GUIDE.bands.find((b) => b.upTo === null || v <= b.upTo) ?? null;
}
