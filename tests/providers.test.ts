import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { observationSchema, type ConcentrationObservation } from "@/lib/domain/schemas";
import { countryAt } from "@/lib/geo/boundaries";
import { confidenceLabel, parseFirmsCsv, regionalFileUrl, windowSuffix } from "@/lib/providers/firms";
import { normalisePollutantLabel, parseOpenDosm } from "@/lib/providers/my-opendosm";
import { myDoeApims } from "@/lib/providers/my-doe-apims";
import { parseNeaPayload } from "@/lib/providers/sg-nea-air";
import { convertWeatherValue, parseWeatherPayload } from "@/lib/providers/sg-nea-weather";
import { PayloadError } from "@/lib/providers/types";

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const meta = { retrievedAtUtc: "2026-10-22T14:30:00.000Z", sourceUrl: "https://api-open.data.gov.sg/v2/real-time/api/psi" };

describe("Singapore NEA adapter", () => {
  it("parses the recorded PSI payload into region aggregates with the PSI scale named", () => {
    const r = parseNeaPayload(JSON.parse(fixture("nea-psi-2026-10-22.json")), "psi", meta);
    expect(r.stations).toHaveLength(5);
    expect(r.stations.every((s) => s.kind === "region_aggregate")).toBe(true);
    expect(r.stations.map((s) => s.externalId)).toEqual(["north", "south", "east", "west", "central"]);

    const westPsi = r.observations.find((o) => o.kind === "index" && o.stationId === "sg-nea-air:west");
    expect(westPsi).toMatchObject({ kind: "index", indexId: "SG_PSI", value: 89, averagingPeriod: "PT24H" });
    expect(westPsi?.observedAtUtc).toBe("2026-10-22T12:00:00.000Z");
    expect(westPsi?.original.timestamp).toBe("2026-10-22T20:00:00+08:00");

    const westPm25 = r.observations.find((o) => o.kind === "concentration" && o.pollutant === "PM2.5" && o.stationId === "sg-nea-air:west");
    expect(westPm25).toMatchObject({ value: 46, unit: "µg/m³", averagingPeriod: "PT24H" });
    for (const o of r.observations) expect(observationSchema.safeParse(o).success).toBe(true);
  });

  it("does not turn the PM2.5 sub-index into a concentration or the PSI into an AQI", () => {
    const r = parseNeaPayload(JSON.parse(fixture("nea-psi-2026-10-22.json")), "psi", meta);
    const kinds = new Set(r.observations.map((o) => (o.kind === "index" ? o.indexId : o.kind === "concentration" ? `${o.pollutant}/${o.averagingPeriod}` : o.kind)));
    expect([...kinds].sort()).toEqual(["PM10/PT24H", "PM2.5/PT24H", "SG_PSI"]);
  });

  it("parses the 1-hour PM2.5 endpoint", () => {
    const r = parseNeaPayload(JSON.parse(fixture("nea-pm25-2026-10-22.json")), "pm25", meta);
    expect(r.observations).toHaveLength(5);
    expect(r.observations.every((o) => o.kind === "concentration" && o.averagingPeriod === "PT1H")).toBe(true);
  });

  it("records a missing regional value as null, never zero", () => {
    const payload = JSON.parse(fixture("nea-pm25-2026-10-22.json"));
    delete payload.data.items[0].readings.pm25_one_hourly.east;
    payload.data.items[0].readings.pm25_one_hourly.west = null;
    const r = parseNeaPayload(payload, "pm25", meta);
    const byRegion = Object.fromEntries(r.observations.map((o) => [o.stationId.split(":")[1], o.value]));
    expect(byRegion.east).toBeNull();
    expect(byRegion.west).toBeNull();
    expect(byRegion.north).toBe(30);
  });

  it("raises on an API error code or a reshaped payload instead of returning empty data", () => {
    expect(() => parseNeaPayload({ code: 1, errorMsg: "Invalid date", data: null }, "psi", meta)).toThrow(/Invalid date/);
    expect(() => parseNeaPayload({ items: [] }, "psi", meta)).toThrow(PayloadError);
  });
});

describe("Singapore weather adapter", () => {
  it("converts knots to m/s explicitly and keeps the original", () => {
    expect(convertWeatherValue("wind_speed", "knots", 10)).toEqual({ value: 5.14, unit: "m/s" });
    expect(convertWeatherValue("temperature", "deg C", 31.8)).toEqual({ value: 31.8, unit: "°C" });
  });

  it("rejects units it has not been taught rather than guessing", () => {
    expect(convertWeatherValue("temperature", "deg F", 90)).toBeNull();
    const r = parseWeatherPayload(
      {
        code: 0,
        data: {
          stations: [{ id: "S109", name: "Ang Mo Kio Avenue 5", location: { latitude: 1.3793, longitude: 103.85 } }],
          readings: [{ timestamp: "2026-10-22T17:23:00+08:00", data: [{ stationId: "S109", value: 89 }] }],
          readingUnit: "deg F",
        },
      },
      { endpoint: "air-temperature", parameter: "temperature", averagingPeriod: "PT1M" },
      meta,
    );
    expect(r.observations).toHaveLength(0);
    expect(r.invalidItems).toBe(1);
    expect(r.warnings[0]).toMatch(/Unrecognised unit/);
  });
});

describe("Malaysia OpenDOSM adapter", () => {
  it("normalises the pollutant labels the API uses", () => {
    expect(normalisePollutantLabel("PM 2.5")).toBe("pm25");
    expect(normalisePollutantLabel("PM₂.₅")).toBe("pm25");
    expect(normalisePollutantLabel("NO²")).toBe("no2");
  });

  it("emits national monthly means with units per pollutant and keeps nulls", () => {
    const r = parseOpenDosm(
      [
        { date: "2024-12-01", pollutant: "PM 2.5", concentration: 11.54 },
        { date: "2024-12-01", pollutant: "CO", concentration: null },
        { date: "2024-12-01", pollutant: "NO2", concentration: 0.0067 },
        { date: "2024-12-01", pollutant: "Benzene", concentration: 1 },
        { date: "Dec 2024", pollutant: "PM 10", concentration: 18.89 },
      ],
      meta,
    );
    expect(r.stations[0]).toMatchObject({ kind: "national_aggregate", latitude: null });
    expect(r.observations).toHaveLength(3);
    const conc = r.observations.filter((o): o is ConcentrationObservation => o.kind === "concentration");
    const pm = conc.find((o) => o.pollutant === "PM2.5")!;
    expect(pm).toMatchObject({ value: 11.54, unit: "µg/m³", averagingPeriod: "P1M" });
    expect(pm.observedAtUtc).toBe("2024-11-30T16:00:00.000Z");
    expect(conc.find((o) => o.pollutant === "CO")!.value).toBeNull();
    expect(conc.find((o) => o.pollutant === "NO2")!.unit).toBe("ppm");
    expect(r.invalidItems).toBe(2);
    expect(r.warnings[0]).toMatch(/Benzene/);
  });
});

describe("Malaysia APIMS adapter", () => {
  it("is honestly marked as not connected and never returns readings", async () => {
    expect(myDoeApims.connection({})).toMatchObject({ status: "not_connected", reason: "no_documented_access" });
    await expect(myDoeApims.fetchLatest!({ now: new Date(), env: {} })).rejects.toThrow(/not connected/);
  });
});

describe("FIRMS adapter", () => {
  const r = parseFirmsCsv(fixture("firms-sample.csv"), { retrievedAtUtc: meta.retrievedAtUtc, sourceUrl: "https://firms.example/x.csv", fallbackSatellite: "NOAA-20" });

  it("drops malformed and truncated rows, de-duplicates repeats and keeps to the regional frame", () => {
    expect(r.invalidItems).toBe(2);
    expect(r.hotspots).toHaveLength(4);
    expect(r.warnings.join(" ")).toMatch(/1 detection\(s\) outside the Southeast Asia frame/);
  });

  it("reads acquisition time as UTC and keeps the raw confidence", () => {
    const kl = r.hotspots.find((h) => h.latitude === 3.139)!;
    expect(kl.acquiredAtUtc).toBe("2026-10-17T05:45:00.000Z");
    expect(kl.confidenceRaw).toBe("high");
    expect(kl.confidenceScale).toBe("categorical");
    expect(kl.kind).toBe("satellite_thermal_anomaly");
    expect(r.hotspots.find((h) => h.frpMegawatts === null)).toBeDefined();
  });

  it("labels country by land polygon, not by overlapping bounding boxes", () => {
    const byLat = Object.fromEntries(r.hotspots.map((h) => [h.latitude, h.countryCode]));
    expect(byLat[3.139]).toBe("MY"); // Kuala Lumpur
    expect(byLat[1.3521]).toBe("SG"); // inside Malaysia's bounding box, but Singapore
    expect(byLat[-0.023]).toBe("ID"); // Pontianak, West Kalimantan
    expect(byLat[4.5]).toBeNull(); // South China Sea
    expect(byLat[-7.43602]).toBeUndefined(); // east of the regional frame (New Guinea), excluded earlier
  });

  it("maps windows to the published regional files", () => {
    expect(windowSuffix(1)).toBe("24h");
    expect(windowSuffix(2)).toBe("48h");
    expect(windowSuffix(5)).toBe("7d");
    expect(regionalFileUrl({ satellite: "NOAA-20", dir: "noaa-20-viirs-c2", prefix: "J1_VIIRS_C2", apiSource: "VIIRS_NOAA20_NRT" }, 1)).toBe(
      "https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_SouthEast_Asia_24h.csv",
    );
    expect(confidenceLabel("n")).toBe("nominal");
    expect(confidenceLabel(null)).toBe("unknown");
  });

  it("knows a few reference points", () => {
    expect(countryAt(13.7563, 100.5018)).toBe("TH"); // Bangkok
    expect(countryAt(4.9031, 114.9398)).toBe("BN"); // Bandar Seri Begawan
    expect(countryAt(1.4927, 103.7414)).toBe("MY"); // Johor Bahru
    expect(countryAt(14.5995, 120.9842)).toBe("PH"); // Manila
  });
});
