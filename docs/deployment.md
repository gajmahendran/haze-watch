# Deployment

The app is a standard Next.js 16 project (App Router, Cache Components). Content pages are prerendered
at build time; API routes run on demand. Node 20 or later.

## Vercel (simplest)

1. Import the repository. Framework preset: Next.js. Build command `npm run build`.
2. Set environment variables from `.env.example`. At minimum `NEXT_PUBLIC_SITE_URL` and
   `NEXT_PUBLIC_CORRECTIONS_EMAIL`. Do not set `HAZE_DEMO_MODE` in production (it is ignored there anyway).
3. Optional persistence: create a Supabase project, run `supabase/migrations/0001_init.sql` in the SQL
   editor, then set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-only).
4. Optional scheduled ingestion: set `CRON_SECRET` (16+ characters). `vercel.json` schedules
   `/api/ingest` once a day (00:10 UTC, give or take an hour), because Vercel's Hobby plan fails any
   deployment whose cron runs more often. Vercel sends the secret as a bearer token. For hourly
   ingestion, either move to Pro and set the schedule to `10 * * * *`, or call the endpoint hourly from
   another scheduler: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-site/api/ingest`.
   The live pages do not depend on ingestion; they read the sources directly with caching.
5. Put the site behind the platform firewall or a CDN rule for `/api/*`. The in-app rate limiter is
   per instance and best-effort.

## Any Node host

```bash
npm ci
npm run build
NODE_ENV=production npm start   # serves on port 3000
```

Run a scheduler (cron, systemd timer) that calls `/api/ingest` with the bearer secret every hour if
persistence is configured.

## Before going live

- [ ] `npm run check` passes (lint, types, tests, content validation).
- [ ] `NEXT_PUBLIC_CORRECTIONS_EMAIL` is a monitored address.
- [ ] Map tile provider terms reviewed (default CARTO basemaps), or `NEXT_PUBLIC_MAP_TILE_URL` set.
- [ ] Singapore Open Data Licence attribution visible (footer and /about already include it).
- [ ] Malaysia API band labels confirmed against a DOE document; then set
      `bandsVerifiedAgainstSource: true` in `src/lib/domain/indices.ts`.
- [ ] `/api/providers` shows each connected source succeeding from the production network.
