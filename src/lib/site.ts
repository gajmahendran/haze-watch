/** Site-level configuration read from public environment variables. */

export const SITE_NAME = "Southeast Asia Haze Watch";

export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

/** Corrections contact. Deliberately empty until the operator sets one: no placeholder address. */
export function correctionsContact(): string | null {
  const v = process.env.NEXT_PUBLIC_CORRECTIONS_EMAIL?.trim();
  return v ? v : null;
}

export const MAP_TILES = {
  url: process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  attribution:
    process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ||
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};
