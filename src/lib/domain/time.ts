/**
 * Timestamp normalisation.
 *
 * Source systems report local time, often without an explicit offset. We always keep the original
 * string and zone alongside a UTC instant, so nothing is silently reinterpreted.
 *
 * Every Southeast Asian zone used here is a fixed offset with no daylight saving, so a static table
 * is exact and avoids depending on the runtime's ICU data. Display formatting is deterministic
 * (identical on server and client), which avoids hydration mismatches.
 */

export const ZONES = {
  UTC: { offsetMinutes: 0, abbr: "UTC" },
  "Asia/Singapore": { offsetMinutes: 480, abbr: "SGT" },
  "Asia/Kuala_Lumpur": { offsetMinutes: 480, abbr: "MYT" },
  "Asia/Brunei": { offsetMinutes: 480, abbr: "BNT" },
  "Asia/Manila": { offsetMinutes: 480, abbr: "PHT" },
  "Asia/Makassar": { offsetMinutes: 480, abbr: "WITA" },
  "Asia/Jakarta": { offsetMinutes: 420, abbr: "WIB" },
  "Asia/Pontianak": { offsetMinutes: 420, abbr: "WIB" },
  "Asia/Jayapura": { offsetMinutes: 540, abbr: "WIT" },
  "Asia/Bangkok": { offsetMinutes: 420, abbr: "ICT" },
  "Asia/Ho_Chi_Minh": { offsetMinutes: 420, abbr: "ICT" },
  "Asia/Vientiane": { offsetMinutes: 420, abbr: "ICT" },
  "Asia/Phnom_Penh": { offsetMinutes: 420, abbr: "ICT" },
  "Asia/Yangon": { offsetMinutes: 390, abbr: "MMT" },
} as const;

export type KnownTimezone = keyof typeof ZONES;

export function isKnownTimezone(value: string): value is KnownTimezone {
  return Object.prototype.hasOwnProperty.call(ZONES, value);
}

export class TimestampError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimestampError";
  }
}

export interface ParsedTimestamp {
  /** UTC instant, ISO 8601 with milliseconds and trailing Z. */
  utcIso: string;
  /** The exact string the source supplied. */
  sourceTimestamp: string;
  /** IANA name when a fallback zone was applied, otherwise the numeric offset found in the string, e.g. "+08:00". */
  sourceTimezone: string;
  offsetMinutes: number;
}

const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

function offsetToMinutes(token: string): number {
  if (token === "Z") return 0;
  const sign = token.startsWith("-") ? -1 : 1;
  const digits = token.slice(1).replace(":", "");
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2, 4));
  if (hours > 14 || minutes > 59) throw new TimestampError(`Invalid UTC offset: ${token}`);
  return sign * (hours * 60 + minutes);
}

function formatOffset(minutes: number): string {
  if (minutes === 0) return "+00:00";
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Parses a source timestamp into UTC.
 * - If the string carries an offset (or Z), that offset is used.
 * - Otherwise `fallbackZone` must be supplied; we refuse to guess.
 * Throws `TimestampError` for malformed or impossible dates (e.g. 2026-02-30).
 */
export function parseSourceTimestamp(raw: string, fallbackZone?: string): ParsedTimestamp {
  const match = TIMESTAMP_PATTERN.exec(raw.trim());
  if (!match) throw new TimestampError(`Unrecognised timestamp format: "${raw}"`);

  const [, y, mo, d, h, mi, s, offsetToken] = match;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = s === undefined ? 0 : Number(s);

  let offsetMinutes: number;
  let sourceTimezone: string;
  if (offsetToken) {
    offsetMinutes = offsetToMinutes(offsetToken);
    sourceTimezone = formatOffset(offsetMinutes);
  } else {
    if (!fallbackZone) {
      throw new TimestampError(`Timestamp "${raw}" has no offset and no fallback timezone was supplied.`);
    }
    if (!isKnownTimezone(fallbackZone)) throw new TimestampError(`Unknown timezone: ${fallbackZone}`);
    offsetMinutes = ZONES[fallbackZone].offsetMinutes;
    sourceTimezone = fallbackZone;
  }

  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wallClock);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute
  ) {
    throw new TimestampError(`Impossible calendar date or time: "${raw}"`);
  }

  return {
    utcIso: new Date(wallClock - offsetMinutes * 60_000).toISOString(),
    sourceTimestamp: raw,
    sourceTimezone,
    offsetMinutes,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar parts for a UTC instant in a fixed-offset zone. */
export function localParts(utcIso: string, zone: KnownTimezone) {
  const ms = Date.parse(utcIso);
  if (Number.isNaN(ms)) throw new TimestampError(`Invalid UTC timestamp: "${utcIso}"`);
  const local = new Date(ms + ZONES[zone].offsetMinutes * 60_000);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

/** "22 Oct 2026, 17:20 MYT". Deterministic, so safe to render on server and client. */
export function formatInZone(utcIso: string, zone: KnownTimezone): string {
  const p = localParts(utcIso, zone);
  return `${p.day} ${MONTHS[p.month - 1]} ${p.year}, ${pad(p.hour)}:${pad(p.minute)} ${ZONES[zone].abbr}`;
}

/** "22 Oct 2026, 09:20 UTC" */
export function formatUtc(utcIso: string): string {
  return formatInZone(utcIso, "UTC");
}

/** YYYY-MM-DD for the local calendar day in a zone. Used for daily bucketing. */
export function localDateKey(utcIso: string, zone: KnownTimezone): string {
  const p = localParts(utcIso, zone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** YYYY-MM for the local calendar month in a zone. */
export function localMonthKey(utcIso: string, zone: KnownTimezone): string {
  return localDateKey(utcIso, zone).slice(0, 7);
}
