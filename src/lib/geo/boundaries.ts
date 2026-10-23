import type { MultiPolygon, Polygon, Position } from "geojson";
import { isCountryCode, type CountryCode } from "../domain/countries";
import data from "./data/sea-10m.json";

/**
 * Country labelling for points (hotspots) using Natural Earth 1:10m land boundaries.
 *
 * Why not bounding boxes: country boxes in this region overlap heavily (Malaysia's box contains
 * Singapore, Brunei and part of Indonesia), so a box would put detections in the wrong country.
 *
 * Limits, shown on the methodology page:
 *  - Natural Earth lines are de facto boundaries, simplified. Points within a few hundred metres of a
 *    border or coastline can be labelled wrongly or not at all.
 *  - A label is geography only. It never implies who or what caused a detection.
 */

interface CountryShape {
  code: CountryCode;
  name: string;
  /** [west, south, east, north] of the polygon set, for a cheap pre-check. */
  bbox: [number, number, number, number];
  polygons: Position[][][];
}

interface RawFeature {
  properties: { code: string; name: string };
  geometry: Polygon | MultiPolygon;
}

function boundsOf(polygons: Position[][][]): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const poly of polygons) {
    for (const [x, y] of poly[0] ?? []) {
      if ((x as number) < w) w = x as number;
      if ((x as number) > e) e = x as number;
      if ((y as number) < s) s = y as number;
      if ((y as number) > n) n = y as number;
    }
  }
  return [w, s, e, n];
}

const SHAPES: CountryShape[] = (data as unknown as { features: RawFeature[] }).features.flatMap((f) => {
  if (!isCountryCode(f.properties.code)) return [];
  const polygons = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  return [{ code: f.properties.code, name: f.properties.name, bbox: boundsOf(polygons), polygons }];
});

/** Ray casting on one ring. Points exactly on an edge may fall either way; that is acceptable here. */
function inRing(lon: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0] as number;
    const yi = ring[i]![1] as number;
    const xj = ring[j]![0] as number;
    const yj = ring[j]![1] as number;
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(lon: number, lat: number, polygon: Position[][]): boolean {
  const [outer, ...holes] = polygon;
  if (!outer || !inRing(lon, lat, outer)) return false;
  return !holes.some((hole) => inRing(lon, lat, hole));
}

/** Country whose land boundary contains the point, or null. */
export function countryAt(latitude: number, longitude: number): CountryCode | null {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  for (const shape of SHAPES) {
    const [w, s, e, n] = shape.bbox;
    if (longitude < w || longitude > e || latitude < s || latitude > n) continue;
    if (shape.polygons.some((p) => inPolygon(longitude, latitude, p))) return shape.code;
  }
  return null;
}

export const BOUNDARY_SOURCE = {
  name: "Natural Earth 1:10m Admin 0 countries (via world-atlas)",
  url: "https://www.naturalearthdata.com/",
  licence: "Public domain",
  note: "De facto boundaries, simplified. Not an endorsement of any territorial claim.",
} as const;
