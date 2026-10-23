/**
 * Extracts the ten covered countries from Natural Earth (via the `world-atlas` package) into two
 * small GeoJSON files:
 *
 *   src/lib/geo/data/sea-10m.json  1:10m, used on the server to label hotspots by country
 *   public/geo/sea-50m.json      1:50m, used in the browser to draw outlines
 *
 *   npx tsx scripts/build-boundaries.ts
 *
 * Natural Earth is public domain. Its boundaries are de facto lines and are not an endorsement of
 * any territorial claim; the methodology page says so.
 */
import fs from "node:fs";
import path from "node:path";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon, Position } from "geojson";

const ISO_NUMERIC: Record<string, string> = {
  "458": "MY",
  "702": "SG",
  "360": "ID",
  "096": "BN",
  "764": "TH",
  "704": "VN",
  "608": "PH",
  "418": "LA",
  "116": "KH",
  "104": "MM",
};

function round(coords: Position[], dp: number): Position[] {
  const f = 10 ** dp;
  const out: Position[] = [];
  for (const [x, y] of coords) {
    const p: Position = [Math.round((x as number) * f) / f, Math.round((y as number) * f) / f];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return out;
}

function simplifyGeometry(g: Geometry, dp: number): Polygon | MultiPolygon {
  if (g.type === "Polygon") return { type: "Polygon", coordinates: g.coordinates.map((r) => round(r, dp)) };
  if (g.type === "MultiPolygon") {
    return { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map((r) => round(r, dp))) };
  }
  throw new Error(`Unexpected geometry ${g.type}`);
}

function extract(file: string, dp: number, out: string) {
  const topo = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "node_modules", "world-atlas", file), "utf8"),
  ) as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  const all = feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>;
  const features: Feature<Polygon | MultiPolygon, { code: string; name: string }>[] = [];
  for (const f of all.features) {
    const code = ISO_NUMERIC[String(f.id)];
    if (!code || !f.geometry) continue;
    features.push({
      type: "Feature",
      properties: { code, name: f.properties.name },
      geometry: simplifyGeometry(f.geometry, dp),
    });
  }
  const found = new Set(features.map((f) => f.properties.code));
  const missing = Object.values(ISO_NUMERIC).filter((c) => !found.has(c));
  if (missing.length) throw new Error(`${file}: missing ${missing.join(", ")}`);
  const fc = { type: "FeatureCollection", source: `Natural Earth via world-atlas/${file}`, features };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(fc));
  console.log(`${out}: ${features.length} countries, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

const dir = path.join(process.cwd(), "src", "lib", "geo", "data");
extract("countries-10m.json", 3, path.join(dir, "sea-10m.json"));
extract("countries-50m.json", 2, path.join(process.cwd(), "public", "geo", "sea-50m.json"));
