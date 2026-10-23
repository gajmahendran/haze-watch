-- Southeast Asia Haze Watch: initial schema
--
-- Principles
--   * Original source values and timestamps are stored next to normalised values, never replaced.
--   * Every observation table has a unique natural key, so repeated ingestion cannot duplicate rows.
--   * Missing values are NULL. Nothing is coerced to zero.
--   * National indices live in their own table with an index_id, so PSI and API can never share a
--     column of "AQI" values.
--   * Row level security: the public may read published data; only the service role writes.

create extension if not exists "pgcrypto";

-- Reference ---------------------------------------------------------------------------------------

create table if not exists countries (
  code          char(2) primary key,
  name          text not null,
  timezone      text not null,
  mvp_priority  boolean not null default false
);

insert into countries (code, name, timezone, mvp_priority) values
  ('MY','Malaysia','Asia/Kuala_Lumpur',true),
  ('SG','Singapore','Asia/Singapore',true),
  ('ID','Indonesia','Asia/Jakarta',false),
  ('BN','Brunei','Asia/Brunei',false),
  ('TH','Thailand','Asia/Bangkok',false),
  ('VN','Vietnam','Asia/Ho_Chi_Minh',false),
  ('PH','Philippines','Asia/Manila',false),
  ('LA','Laos','Asia/Vientiane',false),
  ('KH','Cambodia','Asia/Phnom_Penh',false),
  ('MM','Myanmar','Asia/Yangon',false)
on conflict (code) do nothing;

create table if not exists regions (
  id            text primary key,
  country_code  char(2) not null references countries(code),
  name          text not null,
  kind          text not null check (kind in ('city','state','region','other'))
);

create table if not exists data_sources (
  id                         text primary key,
  name                       text not null,
  operator                   text not null,
  homepage                   text not null,
  docs_url                   text not null,
  licence                    text not null,
  attribution                text not null,
  role                       text not null check (role in ('live','historical','hotspots')),
  access_method              text not null check (access_method in ('documented_api','public_download','credentials_required','web_only','demo')),
  expected_interval_minutes  integer,
  interval_note              text,
  updated_at                 timestamptz not null default now()
);

create table if not exists stations (
  id            text primary key,              -- "<provider>:<external id>"
  provider_id   text not null,
  external_id   text not null,
  name          text not null,
  country_code  char(2) not null references countries(code),
  region_id     text references regions(id),
  kind          text not null check (kind in ('station','region_aggregate','national_aggregate')),
  latitude      double precision check (latitude between -90 and 90),
  longitude     double precision check (longitude between -180 and 180),
  area          text,
  unique (provider_id, external_id)
);

-- Observations ------------------------------------------------------------------------------------

-- Columns shared by the three observation tables.
--   observed_at        UTC instant
--   source_timestamp   timestamp string exactly as published
--   source_timezone    zone or offset used to interpret it
--   original_value     value exactly as published (text, so "N/A" and similar survive)

create table if not exists index_observations (
  id                  bigint generated always as identity primary key,
  provider_id         text not null,
  station_id          text not null references stations(id),
  country_code        char(2) not null references countries(code),
  index_id            text not null check (index_id in ('SG_PSI','MY_API')),
  averaging_period    text not null,
  observed_at         timestamptz not null,
  value               numeric check (value is null or value >= 0),
  dominant_pollutant  text,
  original_value      text,
  original_unit       text,
  source_timestamp    text not null,
  source_timezone     text not null,
  retrieved_at        timestamptz not null,
  quality             text not null check (quality in ('unvalidated','validated','estimated','flagged')),
  provenance          text not null check (provenance in ('provider','demo')),
  source_url          text not null,
  unique (provider_id, station_id, observed_at, index_id, averaging_period)
);

create table if not exists pollutant_measurements (
  id                bigint generated always as identity primary key,
  provider_id       text not null,
  station_id        text not null references stations(id),
  country_code      char(2) not null references countries(code),
  pollutant         text not null check (pollutant in ('PM2.5','PM10','O3','NO2','SO2','CO')),
  unit              text not null check (unit in ('µg/m³','mg/m³','ppm','ppb')),
  averaging_period  text not null,
  observed_at       timestamptz not null,
  value             numeric check (value is null or value >= 0),
  original_value    text,
  original_unit     text,
  source_timestamp  text not null,
  source_timezone   text not null,
  retrieved_at      timestamptz not null,
  quality           text not null check (quality in ('unvalidated','validated','estimated','flagged')),
  provenance        text not null check (provenance in ('provider','demo')),
  source_url        text not null,
  unique (provider_id, station_id, observed_at, pollutant, averaging_period)
);

create table if not exists weather_observations (
  id                bigint generated always as identity primary key,
  provider_id       text not null,
  station_id        text not null references stations(id),
  country_code      char(2) not null references countries(code),
  parameter         text not null check (parameter in ('temperature','relative_humidity','wind_speed','wind_direction')),
  unit              text not null,
  averaging_period  text not null,
  observed_at       timestamptz not null,
  value             numeric,
  original_value    text,
  original_unit     text,
  source_timestamp  text not null,
  source_timezone   text not null,
  retrieved_at      timestamptz not null,
  quality           text not null check (quality in ('unvalidated','validated','estimated','flagged')),
  provenance        text not null check (provenance in ('provider','demo')),
  source_url        text not null,
  unique (provider_id, station_id, observed_at, parameter, averaging_period)
);

-- Normalised values derived for comparison (for example a documented unit conversion) go here,
-- linked to the original row, so source records are never edited.
create table if not exists normalised_values (
  id                bigint generated always as identity primary key,
  source_table      text not null check (source_table in ('index_observations','pollutant_measurements','weather_observations')),
  source_row_id     bigint not null,
  method            text not null,              -- e.g. 'unit:knots->m/s'
  value             numeric,
  unit              text not null,
  created_at        timestamptz not null default now(),
  unique (source_table, source_row_id, method)
);

create index if not exists idx_index_obs_series on index_observations (station_id, index_id, averaging_period, observed_at desc);
create index if not exists idx_pollutant_series on pollutant_measurements (station_id, pollutant, averaging_period, observed_at desc);
create index if not exists idx_weather_series on weather_observations (station_id, parameter, observed_at desc);

-- Hotspots ----------------------------------------------------------------------------------------

create table if not exists hotspot_detections (
  id                text primary key,           -- satellite + acquisition time + position
  provider_id       text not null,
  kind              text not null default 'satellite_thermal_anomaly' check (kind = 'satellite_thermal_anomaly'),
  latitude          double precision not null check (latitude between -90 and 90),
  longitude         double precision not null check (longitude between -180 and 180),
  acquired_at       timestamptz not null,
  satellite         text,
  instrument        text,
  confidence_raw    text,
  confidence_scale  text not null check (confidence_scale in ('categorical','percent','unknown')),
  frp_mw            numeric check (frp_mw is null or frp_mw >= 0),
  day_night         char(1) check (day_night in ('D','N')),
  country_code      char(2) references countries(code),   -- geographic label only, never a cause
  retrieved_at      timestamptz not null,
  provenance        text not null check (provenance in ('provider','demo')),
  source_url        text not null
);
create index if not exists idx_hotspots_time on hotspot_detections (acquired_at desc);
create index if not exists idx_hotspots_country_time on hotspot_detections (country_code, acquired_at desc);

-- Editorial content (mirrors /content JSON; the JSON files remain the source of truth for now) ---

create table if not exists haze_events (
  slug          text primary key,
  title         text not null,
  year_start    integer not null,
  year_end      integer not null,
  status        text not null check (status in ('verified','partial','research_agenda')),
  severity      text not null check (severity in ('severe','moderate','minor','unrated')),
  type          text not null check (type in ('transboundary','national','localised','unclear')),
  document      jsonb not null,             -- full validated event record with sources
  last_reviewed date not null
);

create table if not exists research_documents (
  id             text primary key,
  title          text not null,
  publisher      text not null,
  published_date text not null,
  url            text not null,
  regions        text[] not null,
  type           text not null,
  summary        text not null,
  verified_date  date not null
);

-- Operations --------------------------------------------------------------------------------------

create table if not exists ingestion_logs (
  id             uuid primary key default gen_random_uuid(),
  provider_id    text not null,
  started_at     timestamptz not null,
  finished_at    timestamptz not null,
  status         text not null check (status in ('success','partial','failed','skipped')),
  http_status    integer,
  stations_seen  integer not null default 0,
  inserted       integer not null default 0,
  duplicates     integer not null default 0,
  conflicts      integer not null default 0,
  invalid_items  integer not null default 0,
  attempts       integer not null default 0,
  message        text
);
create index if not exists idx_ingestion_logs_provider on ingestion_logs (provider_id, finished_at desc);

-- Row level security ------------------------------------------------------------------------------

alter table countries              enable row level security;
alter table regions                enable row level security;
alter table data_sources           enable row level security;
alter table stations               enable row level security;
alter table index_observations     enable row level security;
alter table pollutant_measurements enable row level security;
alter table weather_observations   enable row level security;
alter table normalised_values      enable row level security;
alter table hotspot_detections     enable row level security;
alter table haze_events            enable row level security;
alter table research_documents     enable row level security;
alter table ingestion_logs         enable row level security;

-- Public read of published, non-demo data. No public write policies exist; the service role
-- bypasses RLS for ingestion.
drop policy if exists "public read countries" on countries;
create policy "public read countries" on countries for select using (true);
drop policy if exists "public read regions" on regions;
create policy "public read regions" on regions for select using (true);
drop policy if exists "public read sources" on data_sources;
create policy "public read sources" on data_sources for select using (true);
drop policy if exists "public read stations" on stations;
create policy "public read stations" on stations for select using (true);
drop policy if exists "public read index obs" on index_observations;
create policy "public read index obs" on index_observations for select using (provenance = 'provider');
drop policy if exists "public read pollutants" on pollutant_measurements;
create policy "public read pollutants" on pollutant_measurements for select using (provenance = 'provider');
drop policy if exists "public read weather" on weather_observations;
create policy "public read weather" on weather_observations for select using (provenance = 'provider');
drop policy if exists "public read normalised" on normalised_values;
create policy "public read normalised" on normalised_values for select using (true);
drop policy if exists "public read hotspots" on hotspot_detections;
create policy "public read hotspots" on hotspot_detections for select using (provenance = 'provider');
drop policy if exists "public read events" on haze_events;
create policy "public read events" on haze_events for select using (true);
drop policy if exists "public read research" on research_documents;
create policy "public read research" on research_documents for select using (true);
-- ingestion_logs: no public policy (operators only).
