import type { IndexId } from "./indices";

export const COUNTRY_CODES = ["MY", "SG", "ID", "BN", "TH", "VN", "PH", "LA", "KH", "MM"] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];

/** [west, south, east, north] in WGS84 degrees. */
export type BBox = readonly [number, number, number, number];

export interface CountryMeta {
  readonly code: CountryCode;
  readonly name: string;
  readonly slug: string;
  /** Primary IANA timezone used to interpret naive source timestamps. */
  readonly timezone: string;
  /**
   * Approximate bounding box, used only to frame the map and to request hotspot data. It is NOT a
   * border. Bounding boxes of neighbouring countries overlap, so never use it to attribute a
   * reading or detection to a country.
   */
  readonly bbox: BBox;
  /** National index this country reports, when documented in this project. `null` = not yet documented. */
  readonly nationalIndexId: IndexId | null;
  /** True for the countries the MVP prioritises. */
  readonly mvpPriority: boolean;
}

export const COUNTRIES: readonly CountryMeta[] = [
  { code: "MY", name: "Malaysia", slug: "malaysia", timezone: "Asia/Kuala_Lumpur", bbox: [99.6, 0.85, 119.3, 7.4], nationalIndexId: "MY_API", mvpPriority: true },
  { code: "SG", name: "Singapore", slug: "singapore", timezone: "Asia/Singapore", bbox: [103.6, 1.16, 104.1, 1.48], nationalIndexId: "SG_PSI", mvpPriority: true },
  { code: "ID", name: "Indonesia", slug: "indonesia", timezone: "Asia/Jakarta", bbox: [95.0, -11.0, 141.0, 6.1], nationalIndexId: null, mvpPriority: false },
  { code: "BN", name: "Brunei", slug: "brunei", timezone: "Asia/Brunei", bbox: [114.0, 4.0, 115.4, 5.1], nationalIndexId: null, mvpPriority: false },
  { code: "TH", name: "Thailand", slug: "thailand", timezone: "Asia/Bangkok", bbox: [97.3, 5.6, 105.7, 20.5], nationalIndexId: null, mvpPriority: false },
  { code: "VN", name: "Vietnam", slug: "vietnam", timezone: "Asia/Ho_Chi_Minh", bbox: [102.1, 8.5, 109.5, 23.4], nationalIndexId: null, mvpPriority: false },
  { code: "PH", name: "Philippines", slug: "philippines", timezone: "Asia/Manila", bbox: [116.9, 4.6, 126.6, 21.2], nationalIndexId: null, mvpPriority: false },
  { code: "LA", name: "Laos", slug: "laos", timezone: "Asia/Vientiane", bbox: [100.1, 13.9, 107.7, 22.5], nationalIndexId: null, mvpPriority: false },
  { code: "KH", name: "Cambodia", slug: "cambodia", timezone: "Asia/Phnom_Penh", bbox: [102.3, 10.4, 107.6, 14.7], nationalIndexId: null, mvpPriority: false },
  { code: "MM", name: "Myanmar", slug: "myanmar", timezone: "Asia/Yangon", bbox: [92.2, 9.6, 101.2, 28.5], nationalIndexId: null, mvpPriority: false },
];

/** Approximate frame for the whole region. */
export const SEA_BBOX: BBox = [92.0, -11.5, 141.5, 28.6];
export const SEA_MAP_CENTER: readonly [number, number] = [4.5, 108.0];
export const SEA_MAP_ZOOM = 5;

const BY_CODE = new Map<string, CountryMeta>(COUNTRIES.map((c) => [c.code, c]));
const BY_SLUG = new Map<string, CountryMeta>(COUNTRIES.map((c) => [c.slug, c]));

export function isCountryCode(value: unknown): value is CountryCode {
  return typeof value === "string" && BY_CODE.has(value);
}

export function getCountry(code: CountryCode): CountryMeta {
  const country = BY_CODE.get(code);
  if (!country) throw new Error(`Unknown country code: ${code}`);
  return country;
}

export function findCountryBySlug(slug: string): CountryMeta | undefined {
  return BY_SLUG.get(slug);
}

export function countryName(code: CountryCode): string {
  return getCountry(code).name;
}

export function bboxCentre(bbox: BBox): [number, number] {
  return [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2];
}
