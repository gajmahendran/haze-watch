import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { CountryLive } from "@/components/country/CountryLive";
import { Cite, SourceList } from "@/components/ui/Citations";
import { LoadingBlock, Note } from "@/components/ui/States";
import { loadCountryProfile, loadEvents } from "@/lib/content/loader";
import { COUNTRIES, findCountryBySlug } from "@/lib/domain/countries";
import { INDEX_REGISTRY } from "@/lib/domain/indices";
import { REAL_AIR_PROVIDERS } from "@/lib/providers/registry";
import { SEVERITY_LABEL, yearsLabel } from "@/lib/ui/events";

export function generateStaticParams() {
  return COUNTRIES.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps<"/countries/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const c = findCountryBySlug(slug);
  if (!c) return { title: "Country not found" };
  return {
    title: `${c.name}: haze, air quality and data`,
    description: `Air quality agencies, national index, monitoring coverage, haze history and data access for ${c.name}.`,
    alternates: { canonical: `/countries/${c.slug}` },
  };
}

const ACCESS: Record<string, string> = {
  documented_api: "Documented API",
  download: "Download",
  web_only: "Website only",
  request_only: "On request",
  unknown: "Unknown",
};

export default function CountryPage({ params }: PageProps<"/countries/[slug]">) {
  return (
    <Suspense fallback={<div className="wrap pt-10"><LoadingBlock label="Loading the country profile" /></div>}>
      <CountryPageBody params={params} />
    </Suspense>
  );
}

async function CountryPageBody({ params }: { params: PageProps<"/countries/[slug]">["params"] }) {
  const { slug } = await params;
  const c = findCountryBySlug(slug);
  if (!c) notFound();
  const p = loadCountryProfile(c.code);
  const events = loadEvents().filter((e) => e.countries.includes(c.code));
  const live = REAL_AIR_PROVIDERS.filter((x) => x.countries.includes(c.code));
  const index = c.nationalIndexId ? INDEX_REGISTRY[c.nationalIndexId] : null;

  return (
    <article className="wrap pt-10">
      <p className="text-sm">
        <Link href="/countries">Country profiles</Link>
      </p>
      <h1 className="mt-3 text-3xl md:text-4xl">{c.name}</h1>
      <p className="mt-3 max-w-[62ch] text-lg text-ash">
        {c.mvpPriority ? "Priority country with connected data sources." : "Planned coverage. No live readings are connected yet."}{" "}
        {p ? `Profile ${p.status === "researched" ? "researched" : "partly researched"}, last reviewed ${p.lastReviewed}.` : "Profile not yet written."}
      </p>

      {p && p.status === "partial" ? (
        <div className="mt-6 max-w-3xl">
          <Note tone="warn">
            Coverage for {c.name} is incomplete. The facts below are those we could confirm from the sources listed; open questions are noted at
            the end.
          </Note>
        </div>
      ) : null}

      <section aria-labelledby="latest-heading" className="mt-12">
        <h2 id="latest-heading" className="text-2xl">
          Latest available air quality
        </h2>
        <div className="mt-4">
          <CountryLive code={c.code} name={c.name} />
        </div>
      </section>

      <section aria-labelledby="coverage-heading" className="mt-12">
        <h2 id="coverage-heading" className="text-2xl">
          Monitoring coverage and data access
        </h2>
        {p && p.monitoring.length > 0 ? (
          <ul className="mt-4 max-w-[70ch] space-y-3">
            {p.monitoring.map((m) => (
              <li key={m.text}>
                {m.text}
                <Cite ids={m.sourceIds} sources={p.sources} />
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-6 overflow-x-auto" tabIndex={0} role="region" aria-label={`Data sources for ${c.name} table`}>
          <table className="data-table min-w-[36rem]">
            <thead>
              <tr>
                <th scope="col">Data source</th>
                <th scope="col">Access</th>
                <th scope="col">Notes</th>
              </tr>
            </thead>
            <tbody>
              {live.map((x) => (
                <tr key={x.id}>
                  <td>
                    <a href={x.homepage}>{x.name}</a>
                  </td>
                  <td>{x.connection({}).status === "connected" ? "Connected on this site" : "Not connected"}</td>
                  <td className="text-ash">{x.connection({}).status === "connected" ? x.intervalNote : (x.connection({}) as { detail: string }).detail}</td>
                </tr>
              ))}
              {(p?.dataAccess ?? [])
                .filter((d) => !live.some((x) => x.homepage === d.url))
                .map((d) => (
                  <tr key={d.url}>
                    <td>
                      <a href={d.url}>{d.name}</a>
                    </td>
                    <td>{ACCESS[d.accessMethod]}</td>
                    <td className="text-ash">{d.note}</td>
                  </tr>
                ))}
              {live.length === 0 && (p?.dataAccess.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={3} className="text-ash">
                    No public data source has been confirmed for {c.name} yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {p ? (
        <>
          <section aria-labelledby="agencies-heading" className="mt-12">
            <h2 id="agencies-heading" className="text-2xl">
              Official agencies
            </h2>
            <ul className="mt-4 grid gap-6 md:grid-cols-2">
              {p.agencies.map((a) => (
                <li key={a.name} className="border-t border-line pt-3">
                  <a href={a.url} className="font-display text-lg">
                    {a.name}
                  </a>
                  <p className="text-sm text-ash">
                    {a.role}
                    <Cite ids={a.sourceIds} sources={p.sources} />
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="index-heading" className="mt-12">
            <h2 id="index-heading" className="text-2xl">
              National air quality index
            </h2>
            {p.nationalIndex ? (
              <div className="mt-4 max-w-[70ch]">
                <p className="font-display text-xl">{p.nationalIndex.name}</p>
                <p className="mt-2">
                  {p.nationalIndex.description}
                  <Cite ids={p.nationalIndex.sourceIds} sources={p.sources} />
                </p>
                {index ? <p className="mt-3 text-sm text-ash">{index.bandsNote}</p> : null}
              </div>
            ) : (
              <p className="mt-4 text-ash">No national index is documented here yet.</p>
            )}
          </section>

          {[
            { id: "season", title: "Seasonal patterns", items: p.seasonalPattern },
            { id: "health", title: "Health context", items: p.healthContext },
          ].map((s) => (
            <section key={s.id} aria-labelledby={`${s.id}-heading`} className="mt-12">
              <h2 id={`${s.id}-heading`} className="text-2xl">
                {s.title}
              </h2>
              {s.items.length ? (
                <ul className="mt-4 max-w-[70ch] space-y-3">
                  {s.items.map((m) => (
                    <li key={m.text}>
                      {m.text}
                      <Cite ids={m.sourceIds} sources={p.sources} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-ash">Not yet documented from a checked source.</p>
              )}
            </section>
          ))}

          <section aria-labelledby="policy-heading" className="mt-12">
            <h2 id="policy-heading" className="text-2xl">
              Policy developments
            </h2>
            {p.policy.length ? (
              <ul className="mt-4 max-w-[70ch] space-y-3">
                {p.policy.map((m) => (
                  <li key={m.text} className="grid gap-1 sm:grid-cols-[8rem_1fr]">
                    <span className="text-sm text-ash">{m.date ?? "Undated"}</span>
                    <span>
                      {m.text}
                      <Cite ids={m.sourceIds} sources={p.sources} />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-ash">Not yet documented from a checked source.</p>
            )}
          </section>
        </>
      ) : null}

      <section aria-labelledby="events-heading" className="mt-12">
        <h2 id="events-heading" className="text-2xl">
          Haze episodes involving {c.name}
        </h2>
        {events.length ? (
          <ul className="mt-4 space-y-2">
            {events.map((e) => (
              <li key={e.slug}>
                <Link href={`/history/${e.slug}`}>{e.title}</Link> <span className="text-sm text-ash">({yearsLabel(e)}, {SEVERITY_LABEL[e.severity].toLowerCase()})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-ash">No episode records mention {c.name} yet.</p>
        )}
      </section>

      {p && p.openQuestions.length ? (
        <section aria-labelledby="open-heading" className="mt-12 max-w-3xl rounded-[var(--radius-panel)] border border-warn/40 p-5">
          <h2 id="open-heading" className="text-xl">
            Open questions
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
            {p.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {p ? <SourceList sources={p.sources} /> : null}
    </article>
  );
}
