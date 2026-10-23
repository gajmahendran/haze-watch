import type { Metadata } from "next";
import Link from "next/link";
import { ConnectionBadge } from "@/components/ui/Badge";
import { Note } from "@/components/ui/States";
import { FRESH_FACTOR, STALE_FACTOR } from "@/lib/domain/freshness";
import { INDEX_REGISTRY } from "@/lib/domain/indices";
import { DEFAULT_MIN_COVERAGE } from "@/lib/domain/stats";
import { BOUNDARY_SOURCE } from "@/lib/geo/boundaries";
import { REAL_AIR_PROVIDERS, REAL_HOTSPOT_PROVIDERS, REVIEWED_SOURCES } from "@/lib/providers/registry";
import { correctionsContact } from "@/lib/site";

export const metadata: Metadata = {
  title: "About and methodology",
  description:
    "How Southeast Asia Haze Watch sources, labels and presents air quality data: national indices, refresh schedules, missing data, known limitations and corrections.",
  alternates: { canonical: "/about" },
};

const ACCESS: Record<string, string> = {
  documented_api: "Documented API",
  public_download: "Public file download",
  credentials_required: "Needs credentials",
  web_only: "Website only",
  demo: "Development fixture",
};

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-16 scroll-mt-24 text-2xl md:text-3xl">
      {children}
    </h2>
  );
}

export default function AboutPage() {
  const providers = [...REAL_AIR_PROVIDERS, ...REAL_HOTSPOT_PROVIDERS];
  const contact = correctionsContact();
  return (
    <div className="wrap pt-10">
      <h1 className="text-3xl md:text-4xl">About and methodology</h1>
      <div className="mt-6 grid grid-cols-1 gap-12 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
          <ol className="space-y-1.5 text-sm">
            {[
              ["purpose", "Purpose"],
              ["sources", "Where the data comes from"],
              ["indices", "How indices are handled"],
              ["refresh", "Refresh schedules and freshness"],
              ["missing", "Missing values"],
              ["methodology", "Episode records and ratings"],
              ["editorial", "Official data and our analysis"],
              ["limitations", "Known limitations"],
              ["attribution", "Attribution and licences"],
              ["corrections", "Corrections"],
            ].map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="no-underline hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div className="measure min-w-0 text-[1.0625rem]">
          <H2 id="purpose">Purpose</H2>
          <p className="mt-4">
            Southeast Asia Haze Watch is an independent platform that brings together official air quality readings, satellite fire detections and
            a sourced history of haze in the region. It is written for residents checking the air, for journalists and researchers, and for
            anyone trying to understand why the haze returns.
          </p>
          <p className="mt-3">
            It is not a government service. For health decisions, follow your national health authority. Readings here are copies of what
            agencies publish, labelled with their source and time.
          </p>

          <H2 id="sources">Where the data comes from</H2>
          <p className="mt-4">
            Each source is reached through an adapter that validates the payload and converts it into one shared format, keeping the original
            value, unit, timestamp and timezone. Sources are only connected through documented or openly published access. Nothing is scraped
            from pages that do not offer data for reuse.
          </p>
          <div className="mt-6 overflow-x-auto" tabIndex={0} role="region" aria-label="Data source status table">
            <table className="data-table min-w-[44rem]">
              <thead>
                <tr>
                  <th scope="col">Source</th>
                  <th scope="col">Status</th>
                  <th scope="col">Access</th>
                  <th scope="col">Cadence</th>
                  <th scope="col">Licence</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => {
                  const c = p.connection({});
                  return (
                    <tr key={p.id}>
                      <td>
                        <a href={p.homepage}>{p.name}</a>
                        <span className="block text-xs text-dim">{p.operator}</span>
                      </td>
                      <td>
                        <ConnectionBadge connected={c.status === "connected"} />
                        {c.status === "not_connected" ? <span className="mt-1 block text-xs text-ash">{c.detail}</span> : null}
                      </td>
                      <td>{ACCESS[p.accessMethod]}</td>
                      <td className="text-ash">{p.intervalNote}</td>
                      <td className="text-ash">{p.licence}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-ash">
            The live status of each feed, including the last fetch attempt and any error, is available as JSON at{" "}
            <a href="/api/providers">/api/providers</a>.
          </p>
          <h3 className="mt-8 text-xl">Sources reviewed but not ingested</h3>
          <ul className="mt-3 space-y-3 text-sm">
            {REVIEWED_SOURCES.map((s) => (
              <li key={s.url}>
                <a href={s.url}>{s.name}</a>. <span className="text-ash">{s.finding}</span>
              </li>
            ))}
          </ul>

          <H2 id="indices">How indices are handled</H2>
          <p className="mt-4">
            Singapore&apos;s PSI, Malaysia&apos;s API, Indonesia&apos;s ISPU and the US AQI are different calculations that happen to share some band
            names. This site never converts one into another, never ranks them together and never prints a value without naming its scale. The
            code refuses such comparisons and the test suite checks that it does.
          </p>
          <p className="mt-3">
            PM2.5 and PM10 are shown as concentrations in µg/m³, and only compared when the pollutant, unit and averaging period all match. WHO
            guideline levels appear as reference lines only on 24-hour charts, labelled as health guidance rather than legal limits.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {Object.values(INDEX_REGISTRY).map((d) => (
              <li key={d.id}>
                <span className="font-semibold">{d.shortName}.</span> <span className="text-ash">{d.bandsNote}</span>
              </li>
            ))}
          </ul>

          <H2 id="refresh">Refresh schedules and freshness</H2>
          <p className="mt-4">
            Each source declares how often it publishes. A reading is marked up to date if it is no older than {FRESH_FACTOR} times that
            interval, delayed up to {STALE_FACTOR} times, and stale beyond that. These thresholds are this site&apos;s editorial choice, not an
            official standard. Stale readings stay visible with their timestamp and a warning. Readings are never described as real time.
          </p>
          <p className="mt-3">
            Responses are cached per source (ten minutes for Singapore air quality, five for weather, thirty for fire detections, a day for
            Malaysia&apos;s monthly series). If a refresh fails, the previous result is shown with its original times and a note that the refresh
            failed. If there is no previous result, nothing is shown. Live times are given in the source country&apos;s time with UTC alongside.
          </p>

          <H2 id="missing">Missing values</H2>
          <p className="mt-4">
            A missing reading is stored and shown as missing, never as zero. Charts leave gaps; tables say &ldquo;No value&rdquo;; CSV exports
            leave the cell empty. Nothing is interpolated. Daily and monthly summaries count missing readings and flag any period with less than{" "}
            {Math.round(DEFAULT_MIN_COVERAGE * 100)} percent of expected readings, which is again this site&apos;s own threshold.
          </p>

          <H2 id="methodology">Episode records and ratings</H2>
          <p className="mt-4">
            Every statement on an episode page is tied to a source that was opened and read when the page was written; the access date is listed.
            Figures are paraphrased and keep their source&apos;s exact metric name and averaging period. A reading is only listed in the readings
            table if the source gives its value, metric, averaging period, place and time.
          </p>
          <p className="mt-3">
            Severity is our editorial label (severe, moderate, minor or not rated) and each rating states its basis in the sources. Episodes are
            marked verified, partly verified, or on the research agenda when we could not establish a notable event. Estimates of costs or harm
            are labelled as estimates and attributed to whoever made them.
          </p>
          <p className="mt-3">
            Fire detections show heat seen from space. They are not proof of a fire&apos;s cause, and this site does not name companies,
            landowners or individuals as responsible because of where a detection falls.
          </p>

          <H2 id="editorial">Official data and our analysis</H2>
          <p className="mt-4">
            Readings, index categories and health advisories come from official agencies and are shown as published. Summaries, severity ratings,
            freshness labels and the automatically written situation summary are this site&apos;s own work and are labelled as such.
          </p>

          <H2 id="limitations">Known limitations</H2>
          <ul className="mt-4 list-disc space-y-2 pl-5">
            <li>Live readings are connected for Singapore only. Malaysia&apos;s live API has no documented public access, so only its monthly national series is shown.</li>
            <li>Singapore&apos;s figures are regional values placed at NEA&apos;s label positions, not individual sensors.</li>
            <li>Malaysia&apos;s API band labels come from a government broadcaster&apos;s report of the DOE scale. DOE&apos;s 2000 guide gives the same bands, but the current edition has not been seen, so they stay provisional.</li>
            <li>NEA&apos;s hourly archive (since April 2014) is published monthly, so the most recent weeks come from the live API, seven days per request unless the database is configured.</li>
            <li>
              Country labels for fire detections use {BOUNDARY_SOURCE.name}. {BOUNDARY_SOURCE.note} Points near coasts or borders may be labelled
              wrongly or not at all.
            </li>
            <li>Peatland and forest cover layers are not yet shown.</li>
            <li>Profiles for eight countries are partial. Their open questions are listed on each page.</li>
            <li>The research library is curated by hand and is not a live news feed.</li>
          </ul>
          <Note tone="demo">
            In development, an explicit demo mode can add synthetic stations and detections, each labelled DEMO. Demo mode cannot be switched on in
            a production build, and demo data is never used to replace a source that fails.
          </Note>

          <H2 id="attribution">Attribution and licences</H2>
          <ul className="mt-4 space-y-2 text-sm">
            {providers.map((p) => (
              <li key={p.id}>
                <span className="font-semibold">{p.name}.</span> <span className="text-ash">{p.attribution}</span>
              </li>
            ))}
            <li>
              <span className="font-semibold">Boundaries.</span> <span className="text-ash">{BOUNDARY_SOURCE.name}, {BOUNDARY_SOURCE.licence}.</span>
            </li>
            <li>
              <span className="font-semibold">Base map.</span> <span className="text-ash">© OpenStreetMap contributors © CARTO. Satellite imagery on the hotspot map from NASA EOSDIS GIBS.</span>
            </li>
          </ul>

          <H2 id="corrections">Corrections</H2>
          <p className="mt-4">
            If something here is wrong, tell us what it is, where it appears and, if you can, a source that shows the correct information. We
            check every report against the original source. Corrections to episode records and profiles are made in the content files and change
            the page&apos;s last-reviewed date; material corrections are noted on the page.
          </p>
          <p className="mt-3">
            Contact:{" "}
            {contact ? <a href={`mailto:${contact}`}>{contact}</a> : <span className="text-ash">not configured yet. The site operator needs to set NEXT_PUBLIC_CORRECTIONS_EMAIL.</span>}
          </p>
          <p className="mt-8 text-sm text-ash">
            <Link href="/learn">Read the explainers</Link> for background on haze, indices and health.
          </p>
        </div>
      </div>
    </div>
  );
}
