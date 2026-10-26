import { OUTSIDE_FRAME_MARKER } from "@/lib/site";
import { SEA_BBOX } from "../domain/countries";
import type { Hotspot } from "../domain/schemas";
import { countryAt } from "../geo/boundaries";
import { fetchWithRetry, limiterFor } from "./http";
import type { AdapterContext, HotspotProvider, HotspotResult } from "./types";

/**
 * NASA FIRMS VIIRS 375 m active fire detections for Southeast Asia.
 *
 * Default access needs no key: FIRMS publishes regional CSV files for the last 24 hours, 48 hours
 * and 7 days for each VIIRS satellite (S-NPP, NOAA-20, NOAA-21). If FIRMS_MAP_KEY is set, the area
 * API is used instead, which is the documented route for arbitrary date windows.
 *
 * Every row is a satellite THERMAL ANOMALY: a pixel hotter than its surroundings when the satellite
 * passed. It may be a vegetation fire, a peat fire, a gas flare, an industrial heat source or a
 * false alarm. It is not a confirmed fire, not a burned area, and carries no information about cause.
 *
 * Attribute meanings (FIRMS attribute table): acq_time is UTC (HHMM); confidence is low, nominal or
 * high; frp is fire radiative power in MW; satellite N = Suomi NPP, N20 = NOAA-20, N21 = NOAA-21.
 */

export const FIRMS_ID = "nasa-firms-viirs";

const FILES = [
  { satellite: "Suomi NPP", dir: "suomi-npp-viirs-c2", prefix: "SUOMI_VIIRS_C2", apiSource: "VIIRS_SNPP_NRT" },
  { satellite: "NOAA-20", dir: "noaa-20-viirs-c2", prefix: "J1_VIIRS_C2", apiSource: "VIIRS_NOAA20_NRT" },
  { satellite: "NOAA-21", dir: "noaa-21-viirs-c2", prefix: "J2_VIIRS_C2", apiSource: "VIIRS_NOAA21_NRT" },
] as const;

const SATELLITE_CODES: Record<string, string> = { N: "Suomi NPP", N20: "NOAA-20", N21: "NOAA-21" };

export function windowSuffix(days: number): "24h" | "48h" | "7d" {
  if (days <= 1) return "24h";
  if (days <= 2) return "48h";
  return "7d";
}

export function regionalFileUrl(file: (typeof FILES)[number], days: number): string {
  return `https://firms.modaps.eosdis.nasa.gov/data/active_fire/${file.dir}/csv/${file.prefix}_SouthEast_Asia_${windowSuffix(days)}.csv`;
}

export function areaApiUrl(key: string, source: string, days: number): string {
  const [w, s, e, n] = SEA_BBOX;
  return `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/${source}/${w},${s},${e},${n}/${Math.min(5, Math.max(1, days))}`;
}

const REQUIRED = ["latitude", "longitude", "acq_date", "acq_time"] as const;

function num(v: string | undefined): number | null {
  if (v === undefined || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses a FIRMS CSV. Columns are found by header name, so the regional files and the area API
 * (which adds an `instrument` column) both work. Rows with the wrong number of cells (a truncated
 * download) or impossible values are counted as invalid and dropped.
 */
export function parseFirmsCsv(
  csv: string,
  meta: { retrievedAtUtc: string; sourceUrl: string; fallbackSatellite: string | null; bbox?: readonly [number, number, number, number] },
): HotspotResult {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = lines.shift()?.split(",").map((h) => h.trim().toLowerCase()) ?? [];
  const col = new Map(header.map((h, i) => [h, i]));
  const missing = REQUIRED.filter((r) => !col.has(r));
  if (missing.length) {
    return { hotspots: [], invalidItems: lines.length, warnings: [`CSV is missing columns: ${missing.join(", ")}`], httpStatus: 200, attempts: 1 };
  }
  const [w, s, e, n] = meta.bbox ?? SEA_BBOX;
  const hotspots: Hotspot[] = [];
  const seen = new Set<string>();
  let invalidItems = 0;
  let outside = 0;

  for (const line of lines) {
    const cells = line.split(",");
    if (cells.length !== header.length) {
      invalidItems += 1;
      continue;
    }
    const get = (name: string) => {
      const i = col.get(name);
      return i === undefined ? undefined : cells[i]?.trim();
    };
    const lat = num(get("latitude"));
    const lon = num(get("longitude"));
    const date = get("acq_date") ?? "";
    const time = (get("acq_time") ?? "").padStart(4, "0");
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180 || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}$/.test(time)) {
      invalidItems += 1;
      continue;
    }
    const hh = Number(time.slice(0, 2));
    const mm = Number(time.slice(2));
    if (hh > 23 || mm > 59) {
      invalidItems += 1;
      continue;
    }
    if (lon < w || lon > e || lat < s || lat > n) {
      outside += 1;
      continue;
    }
    const acquired = new Date(`${date}T${time.slice(0, 2)}:${time.slice(2)}:00Z`);
    if (Number.isNaN(acquired.getTime())) {
      invalidItems += 1;
      continue;
    }
    const satCode = get("satellite") ?? "";
    const satellite = SATELLITE_CODES[satCode] ?? (satCode || meta.fallbackSatellite);
    const id = `${satCode || meta.fallbackSatellite || "viirs"}-${date}-${time}-${lat.toFixed(5)}-${lon.toFixed(5)}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const confidence = get("confidence") ?? null;
    const frp = num(get("frp"));
    const dn = get("daynight");
    hotspots.push({
      id,
      providerId: FIRMS_ID,
      kind: "satellite_thermal_anomaly",
      latitude: lat,
      longitude: lon,
      acquiredAtUtc: acquired.toISOString(),
      satellite: satellite ?? null,
      instrument: get("instrument") || "VIIRS",
      confidenceRaw: confidence || null,
      confidenceScale: confidence && /^(low|nominal|high|l|n|h)$/i.test(confidence) ? "categorical" : confidence && /^\d+$/.test(confidence) ? "percent" : "unknown",
      frpMegawatts: frp !== null && frp >= 0 ? frp : null,
      dayNight: dn === "D" || dn === "N" ? dn : null,
      countryCode: countryAt(lat, lon),
      retrievedAtUtc: meta.retrievedAtUtc,
      provenance: "provider",
      sourceUrl: meta.sourceUrl,
    });
  }
  const warnings: string[] = [];
  if (invalidItems) warnings.push(`${invalidItems} malformed row(s) dropped from ${meta.fallbackSatellite ?? "FIRMS"} file.`);
  if (outside) warnings.push(outsideFrameNote(outside));
  return { hotspots, invalidItems, outsideFrame: outside, warnings, httpStatus: 200, attempts: 1 };
}

/** Routine note, not a fault: the regional files include detections beyond this site's map frame. */
function outsideFrameNote(n: number): string {
  return `${n.toLocaleString("en-GB")} detection${n === 1 ? "" : "s"} ${OUTSIDE_FRAME_MARKER} (for example in South Asia or Australia) are left out.`;
}

/** Normalises the raw confidence to low / nominal / high where the source used letters. */
export function confidenceLabel(raw: string | null): "low" | "nominal" | "high" | "unknown" {
  const v = (raw ?? "").toLowerCase();
  if (v === "l" || v === "low") return "low";
  if (v === "n" || v === "nominal") return "nominal";
  if (v === "h" || v === "high") return "high";
  return "unknown";
}

async function fetchCsv(ctx: AdapterContext, url: string, satellite: string): Promise<HotspotResult> {
  const { response, attempts } = await fetchWithRetry(url, {
    fetchImpl: ctx.fetchImpl,
    sleep: ctx.sleep,
    retries: ctx.retries,
    timeoutMs: 30_000,
    limiter: ctx.fetchImpl ? undefined : limiterFor("firms.modaps.eosdis.nasa.gov", 10, 60_000),
  });
  const text = await response.text();
  const result = parseFirmsCsv(text, { retrievedAtUtc: ctx.now.toISOString(), sourceUrl: url.replace(/\/api\/area\/csv\/[^/]+\//, "/api/area/csv/[MAP_KEY]/"), fallbackSatellite: satellite });
  return { ...result, httpStatus: response.status, attempts };
}

/** Combines the per-satellite "outside the frame" notes into one total. */
function mergeOutsideFrame(warnings: string[], results: HotspotResult[]): string[] {
  const rest = warnings.filter((w) => !w.includes(OUTSIDE_FRAME_MARKER));
  const total = results.reduce((n, r) => n + (r.outsideFrame ?? 0), 0);
  return total ? [...rest, outsideFrameNote(total)] : rest;
}

export const firmsViirs: HotspotProvider = {
  kind: "hotspots",
  id: FIRMS_ID,
  name: "VIIRS active fire detections (NASA FIRMS)",
  operator: "NASA Fire Information for Resource Management System (FIRMS), LANCE",
  homepage: "https://firms.modaps.eosdis.nasa.gov/",
  docsUrl: "https://firms.modaps.eosdis.nasa.gov/api/area/",
  licence: "Openly available from NASA without registration for the regional files. Check FIRMS for current terms of use.",
  attribution: "Fire detections: NASA FIRMS, VIIRS 375 m near real-time active fire product (Suomi NPP, NOAA-20, NOAA-21).",
  countries: ["MY", "SG", "ID", "BN", "TH", "VN", "PH", "LA", "KH", "MM"],
  role: "hotspots",
  accessMethod: "public_download",
  expectedIntervalMinutes: 720,
  intervalNote:
    "Each polar-orbiting satellite passes over a given place about twice a day, so gaps of several hours between detections are normal. Cloud cover hides fires from the sensor.",
  cacheTtlSeconds: 1800,
  connection: () => ({ status: "connected" }),
  async fetchHotspots(ctx, { days }) {
    const key = ctx.env.FIRMS_MAP_KEY;
    const results: HotspotResult[] = [];
    const warnings: string[] = [];
    for (const file of FILES) {
      const url = key && days <= 5 ? areaApiUrl(key, file.apiSource, days) : regionalFileUrl(file, days);
      try {
        results.push(await fetchCsv(ctx, url, file.satellite));
      } catch (error) {
        warnings.push(`${file.satellite}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (results.length === 0) throw new Error(`No FIRMS file could be retrieved. ${warnings.join(" ")}`);
    const seen = new Set<string>();
    const hotspots: Hotspot[] = [];
    for (const r of results) {
      for (const h of r.hotspots) {
        if (seen.has(h.id)) continue;
        seen.add(h.id);
        hotspots.push(h);
      }
    }
    return {
      hotspots,
      invalidItems: results.reduce((n, r) => n + r.invalidItems, 0),
      warnings: mergeOutsideFrame([...warnings, ...results.flatMap((r) => r.warnings)], results),
      httpStatus: results.at(-1)?.httpStatus ?? null,
      attempts: results.reduce((n, r) => n + r.attempts, 0),
    };
  },
};
