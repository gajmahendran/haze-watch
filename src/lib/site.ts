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

/**
 * Optional raster basemap. By default the map draws its own land from Natural Earth (public domain),
 * so it needs no tile service, key or third-party terms. Set NEXT_PUBLIC_MAP_TILE_URL to a tile
 * service you are licensed to use to add one underneath.
 */
export const MAP_TILES: { url: string | null; attribution: string } = {
  url: process.env.NEXT_PUBLIC_MAP_TILE_URL?.trim() || null,
  attribution: process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION?.trim() || "",
};

export const BOUNDARY_ATTRIBUTION =
  'Boundaries: <a href="https://www.naturalearthdata.com/">Natural Earth</a> (public domain), not an endorsement of any claim';

/** Marks the routine FIRMS note about detections beyond the map frame, so the UI can show it quietly. */
export const OUTSIDE_FRAME_MARKER = "outside the Southeast Asia frame";
