import { ProviderNotConnectedError, type AirProvider } from "./types";

/**
 * Malaysia Department of Environment, Air Pollutant Index Management System (APIMS).
 *
 * STATUS: NOT CONNECTED.
 *
 * Checked on 2026-10-23:
 *  - https://eqms.doe.gov.my/apims/main renders client-side and documents no public API, download
 *    or terms of use.
 *  - https://www.doe.gov.my/en/api-2/ describes the Air Pollutant Index (the index, not a
 *    programming interface) in an embedded flipbook, with no data endpoint.
 *
 * The browser app calls internal endpoints, but they are undocumented and unlicensed. Building on
 * them would be fragile scraping of an access path the agency has not offered, so this adapter is
 * deliberately left unconnected.
 *
 * To connect: obtain written permission or a documented endpoint from DOE (contact details are on
 * doe.gov.my), implement `fetchLatest` to emit `IndexObservation`s with `indexId: "MY_API"` and
 * station records, and set MY_DOE_APIMS_ENDPOINT. Keep `original` values exactly as published.
 */
export const myDoeApims: AirProvider = {
  kind: "air",
  id: "my-doe-apims",
  name: "Malaysia Air Pollutant Index, live (DOE APIMS)",
  operator: "Department of Environment Malaysia (Jabatan Alam Sekitar)",
  homepage: "https://eqms.doe.gov.my/apims/main",
  docsUrl: "https://www.doe.gov.my/en/api-2/",
  licence: "No published licence for programmatic reuse found.",
  attribution: "Air Pollutant Index: Department of Environment Malaysia.",
  countries: ["MY"],
  role: "live",
  accessMethod: "web_only",
  expectedIntervalMinutes: 60,
  intervalNote: "DOE publishes the API hourly on its website.",
  cacheTtlSeconds: 600,
  zone: "Asia/Kuala_Lumpur",
  historyChunk: "day",
  maxHistoryDays: 0,
  series: [],
  knownStations: [],
  connection: (env) =>
    env.MY_DOE_APIMS_ENDPOINT
      ? {
          status: "not_connected",
          reason: "not_implemented",
          detail:
            "An endpoint is configured, but no adapter has been written for it yet. See src/lib/providers/my-doe-apims.ts.",
        }
      : {
          status: "not_connected",
          reason: "no_documented_access",
          detail:
            "DOE publishes hourly readings on its website but documents no public API or reuse licence. Live Malaysian readings are not shown until a permitted access method exists.",
        },
  async fetchLatest() {
    throw new ProviderNotConnectedError("my-doe-apims", "no documented public access");
  },
};
