# Southeast Asia Haze Watch

An independent platform documenting haze in Southeast Asia: official air quality readings on their own
scales, satellite fire detections, a sourced history of haze episodes since 1997, country profiles,
explainers and a research library.

The rules that shape everything: never fabricate a reading or citation, never convert one national
index into another, never show missing data as zero, never hide a stale timestamp, and never infer who
caused a fire from where a detection falls.

## Run it

```bash
npm install
npm run dev                         # http://localhost:3000
HAZE_DEMO_MODE=true npm run dev     # adds clearly labelled synthetic data for UI work
npm run check                       # lint + typecheck + tests + content validation
npm run build && npm start          # production
npm run a11y                        # axe-core WCAG 2.1 AA audit of every page (needs a running server)
```

No environment variables are needed for the public sources. See `.env.example` for optional keys,
persistence and the ingestion secret.

## Pages

| Route | What it does |
|---|---|
| `/` | Hero reading, automatic situation summary from real readings, regional map, episode timeline, trends, library, explainers |
| `/live` | Map and tables per national scale; PM2.5 1-hour and 24-hour views; station panel with every value, freshness, nearest weather, 2-day history; coverage table |
| `/history`, `/history/[slug]` | Days in each PSI band per year in Singapore since 2014 (from NEA's archive); filterable timeline; episode pages with readings, impacts, responses, policy, imagery, open questions and citations |
| `/hotspots` | VIIRS thermal anomalies with window, confidence and country (polygon) filters, NASA true-colour imagery, daily counts, strongest detections |
| `/data` | Historical explorer: source, station, measure, dates, as published or daily or monthly summaries (computed on the server over the full record), chart type, period comparison, CSV export |
| `/countries`, `/countries/[slug]` | Ten profiles with live readings, agencies, index, coverage, seasons, health, policy, data access, open questions |
| `/learn` | Sourced explainers, including a side-by-side (not converted) view of PSI, API and NEA PM2.5 bands |
| `/research` | Searchable, hand-checked library of 37 records |
| `/about` | Methodology, source status, index handling, freshness, missing data, limitations, attribution, corrections |

APIs: `/api/snapshot`, `/api/history` (`aggregate=none|day|month`, `format=csv`), `/api/insights/psi-days`,
`/api/hotspots`, `/api/providers`, `/api/ingest` (secret).

## Data sources

Connected: Singapore NEA PSI and PM2.5 and MSS weather (data.gov.sg), NEA's hourly PSI and PM2.5
archive since April 2014 (data.gov.sg dataset downloads), Malaysia monthly national pollutant means
(OpenDOSM), NASA FIRMS VIIRS hotspots. Not connected: Malaysia's live APIMS (no documented access),
ASEAN Haze Portal (no API or licence) and ASMC's WIS2 API (its terms forbid redistribution and
automated access without NEA's written permission). Details in `docs/data-sources.md`.

## Structure

```
content/                 Editorial JSON (events, countries, education, library), validated at build
docs/                    Content guidelines, data sources, deployment
scripts/                 Content validation, boundary extraction, accessibility audit
src/app/                 Pages and API routes
src/components/          ui, site, readings, map, charts, live, history, hotspots, data, research, country
src/lib/domain/          Schemas, indices, time, freshness, stats, CSV (no framework code)
src/lib/providers/       One adapter per source + registry, HTTP retries and rate limiting
src/lib/pipeline/        Cache, validation, dedupe, ingestion logs, snapshot/history/hotspot services
src/lib/store/           Optional Supabase persistence (server-only)
src/lib/geo/             Natural Earth boundaries for country labelling
supabase/migrations/     PostgreSQL schema with natural-key uniqueness and RLS
tests/                   Vitest suites, recorded fixtures, and migration tests that run the SQL in
                         embedded PostgreSQL 17 (PGlite)
```

## Editing content

Add or edit JSON under `content/` following `docs/content-guidelines.md`, then run
`npm run validate:content`. Every claim must cite a listed source; the build fails otherwise.

## Known limitations

See `/about#limitations`. In short: live data covers Singapore only; Malaysia's API band labels are
provisional (DOE's 2000 guide agrees, the current edition is unseen); NEA's archive lags by up to a
month, so the most recent weeks come from the live API in 7-day requests; no peatland layer yet; eight
country profiles are partial.
