# Data sources and adapters

Checked on 23 October 2026. Re-check access, cadence and licence before relying on any of this.

## Connected

| Adapter | Source | Access | Cadence | Licence |
|---|---|---|---|---|
| `sg-nea-air` | NEA PSI and PM2.5 via data.gov.sg (`/v2/real-time/api/psi`, `/pm25`) | Public API, no key needed. Optional `x-api-key` raises limits (6 → 12 or 30 calls per 10 s). `?date=YYYY-MM-DD` returns one local day of hourly items. | Hourly | Singapore Open Data Licence v1.0, attribution required |
| `sg-nea-weather` | MSS weather stations via data.gov.sg (`air-temperature`, `relative-humidity`, `wind-speed`, `wind-direction`) | Public API | About 1 minute (wind is a 10-minute average) | Singapore Open Data Licence v1.0 |
| `my-opendosm` | DOE and DOSM monthly national pollutant means (`api.data.gov.my/data-catalogue?id=air_pollution`) | Public API, 4 requests per minute | Irregular; latest month December 2024 when checked | CC BY 4.0 |
| `nasa-firms-viirs` | NASA FIRMS VIIRS 375 m regional CSVs (Suomi NPP, NOAA-20, NOAA-21) | Public files for 24 h, 48 h, 7 d. Optional `FIRMS_MAP_KEY` switches to the area API | Several times a day | Open NASA data; check FIRMS terms |

What is kept from NEA's PSI payload: 24-hour PSI (index), 24-hour PM2.5 and PM10 and 1-hour PM2.5
(concentrations). Sub-indices and maxima are left out until their averaging definitions are documented.

Unit conversions are explicit and recorded: wind speed knots → m/s (× 0.514444), with the original
value and unit preserved. Any unit an adapter has not been taught is rejected.

## Connected: Singapore archive

| Adapter | Source | Access | Coverage | Licence |
|---|---|---|---|---|
| `sg-nea-archive` | NEA Historical 24-hr PSI (`d_b4cf557f8750260d229c49fd768e11ed`) and Historical 1-hr PM2.5 (`d_6c0d5fc34838b12472475fdb73c0af29`) | data.gov.sg dataset download API: `initiate-download`, `poll-download`, then the CSV (about 5 requests per minute) | Hourly, April 2014 to the latest monthly batch (1 October 2026 when checked) | Singapore Open Data Licence v1.0 |

Each CSV (about 110,000 rows) is downloaded at most once a day per server instance and held as typed
arrays. Raw readings are served up to 366 days per request; daily and monthly summaries are computed
on the server over the whole archive. The archive writes midnight as `0:00` on the following day and
lists each day from 01:00 to 24:00, so daily summaries count the 00:00 reading in the day it closes.
The live API instead dates the 00:00 reading to the new day; each path follows its source.

## Not connected

| Adapter | Why |
|---|---|
| `my-doe-apims` | APIMS is a client-rendered site with no documented API, download or reuse licence. The internal endpoints the browser uses are not offered for reuse, so the adapter is a stub that reports `no_documented_access`. |
| ASEAN Haze Portal | Knowledge platform; no API, download or licence documented. Linked, not ingested. |
| ASMC WIS2 catalogue | Has an API (`api.wis2.asmc.asean.org/collections/...`) for VIIRS hotspots, the daily haze map and dispersion model, classed as WMO "recommended" data. The [terms of use](https://wis2.asmc.asean.org/terms-of-use/) forbid redistribution, commercial use and automated access without NEA's written permission (ASMC_Enquiries@nea.gov.sg, §4.2 and §6.2). Do not connect without that permission. |
| haze.gov.sg historical readings | Web table behind a captcha. Same data comes from data.gov.sg. |

## Adding a source

1. Create `src/lib/providers/<id>.ts` implementing `AirProvider` or `HotspotProvider` from `types.ts`.
2. Validate the raw payload with Zod and emit only the canonical shapes in `src/lib/domain/schemas.ts`.
   Keep `original.value`, `original.unit`, `original.timestamp` and `original.timezone` exactly as published.
3. Missing is `null`. Never coerce to zero, never interpolate.
4. If the source publishes a national index, add it to `INDEX_REGISTRY` with its bands, the URLs they
   were checked against, and `bandsVerifiedAgainstSource`. Do not map it onto another index.
5. Declare `expectedIntervalMinutes` honestly (or `null`) so freshness checks are meaningful.
6. Return `not_connected` from `connection()` when credentials or permission are missing.
7. Register it in `registry.ts`, add a fixture-based test, and document it in this file.

## Pipeline

```
adapter.fetch* → raw payload validation → canonical records
  → validateAir / validateHotspots (schema check, unknown station check, dedupe by natural key)
  → TtlCache (per provider TTL, request coalescing, last-good fallback, 60 s failure memory)
  → /api/snapshot, /api/history, /api/hotspots
  → (scheduled) /api/ingest → Supabase upserts on natural keys + ingestion_logs
```

Retries: network errors, timeouts, 429 and 5xx only; exponential backoff with jitter; `Retry-After`
honoured. User-facing reads retry once; scheduled ingestion retries twice.
