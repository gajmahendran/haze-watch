import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Cite, SourceList } from "@/components/ui/Citations";
import { LoadingBlock, Note } from "@/components/ui/States";
import { loadEvent, loadEvents } from "@/lib/content/loader";
import type { HazeEvent } from "@/lib/content/schema";
import { countryName } from "@/lib/domain/countries";
import { SEVERITY_LABEL, STATUS_LABEL, TYPE_LABEL } from "@/lib/ui/events";

export function generateStaticParams() {
  return loadEvents().map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: PageProps<"/history/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const e = loadEvent(slug);
  if (!e) return { title: "Episode not found" };
  return {
    title: e.title,
    description: e.summary.slice(0, 200),
    alternates: { canonical: `/history/${e.slug}` },
  };
}

const CERTAINTY: Record<HazeEvent["impacts"][number]["certainty"], string> = {
  reported: "Reported",
  estimated: "Estimate",
  contested: "Contested",
};
const IMPACT_KIND: Record<HazeEvent["impacts"][number]["kind"], string> = {
  health: "Health",
  economic: "Economic",
  environmental: "Environmental",
  other: "Other",
};

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-12">
      <h2 id={id} className="text-2xl">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

export default function EventPage({ params }: PageProps<"/history/[slug]">) {
  return (
    <Suspense fallback={<div className="wrap pt-10"><LoadingBlock label="Loading the episode" /></div>}>
      <EventPageBody params={params} />
    </Suspense>
  );
}

async function EventPageBody({ params }: { params: PageProps<"/history/[slug]">["params"] }) {
  const { slug } = await params;
  const e = loadEvent(slug);
  if (!e) notFound();
  const all = loadEvents();
  const i = all.findIndex((x) => x.slug === e.slug);
  const prev = all[i - 1];
  const next = all[i + 1];

  return (
    <article className="wrap pt-10">
      <p className="text-sm">
        <Link href="/history">Historical haze</Link>
      </p>
      <h1 className="mt-3 max-w-[22ch] text-3xl md:text-4xl">{e.title}</h1>
      <dl className="mt-6 grid max-w-3xl gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-ash">Dates</dt>
          <dd>{e.datesLabel}</dd>
        </div>
        <div>
          <dt className="text-ash">Countries affected (as documented)</dt>
          <dd>{e.countries.map(countryName).join(", ")}</dd>
        </div>
        <div>
          <dt className="text-ash">Type</dt>
          <dd>{TYPE_LABEL[e.type]}</dd>
        </div>
        <div>
          <dt className="text-ash">Record status</dt>
          <dd>
            {STATUS_LABEL[e.status]}, last reviewed {e.lastReviewed}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-ash">Severity: {SEVERITY_LABEL[e.severity]}</dt>
          <dd className="measure">{e.severityBasis}</dd>
        </div>
      </dl>

      <div className="mt-10 prose-editorial">
        <p>
          {e.summary}
          <Cite ids={e.summarySourceIds} sources={e.sources} />
        </p>
      </div>

      {e.openQuestions.length > 0 ? (
        <section aria-labelledby="open-heading" className="mt-10 max-w-3xl rounded-[var(--radius-panel)] border border-warn/40 p-5">
          <h2 id="open-heading" className="text-xl">
            What we could not verify
          </h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
            {e.openQuestions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <Section id="readings-heading" title="Recorded readings">
        {e.measurements.length === 0 ? (
          <Note>No reading met our standard for this list: a value with its exact metric, averaging period, place and time from a source we could open.</Note>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recorded readings table">
            <table className="data-table min-w-[44rem]">
              <caption className="sr-only">Readings recorded during this episode</caption>
              <thead>
                <tr>
                  <th scope="col">Where</th>
                  <th scope="col">Measure, as named by the source</th>
                  <th scope="col" className="num">
                    Value
                  </th>
                  <th scope="col">Averaging</th>
                  <th scope="col">When</th>
                  <th scope="col">Source</th>
                </tr>
              </thead>
              <tbody>
                {e.measurements.map((m) => (
                  <tr key={`${m.location}-${m.metric}-${m.observedAt}`}>
                    <td>
                      {m.location}
                      <span className="block text-xs text-dim">{countryName(m.country)}</span>
                    </td>
                    <td>
                      {m.metric}
                      {m.note ? <span className="mt-1 block text-xs text-ash">{m.note}</span> : null}
                    </td>
                    <td className="num numeral text-xl">
                      {m.value}
                      <span className="block font-sans text-xs text-ash">{m.unit}</span>
                    </td>
                    <td>{m.averagingPeriod}</td>
                    <td className="whitespace-nowrap">{m.observedAt.replace("T", " ")}</td>
                    <td>
                      <Cite ids={m.sourceIds} sources={e.sources} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-sm text-ash measure">
              Readings from different indices or averaging periods are listed separately and are not comparable with each other.
            </p>
          </div>
        )}
      </Section>

      {e.fireWeatherContext.length > 0 ? (
        <Section id="fire-heading" title="Fire and weather">
          <ul className="max-w-[66ch] space-y-3">
            {e.fireWeatherContext.map((c) => (
              <li key={c.text}>
                {c.text}
                <Cite ids={c.sourceIds} sources={e.sources} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section id="impacts-heading" title="Health and economic impacts">
        {e.impacts.length === 0 ? (
          <Note>No impacts have been documented from the sources checked so far.</Note>
        ) : (
          <ul className="max-w-[70ch] space-y-4">
            {e.impacts.map((c) => (
              <li key={c.text} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                <span className="text-sm text-ash">
                  {IMPACT_KIND[c.kind]}
                  <span className="block">{CERTAINTY[c.certainty]}</span>
                </span>
                <span>
                  {c.text}
                  <Cite ids={c.sourceIds} sources={e.sources} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {e.responses.length > 0 ? (
        <Section id="responses-heading" title="Government and ASEAN responses">
          <ul className="max-w-[70ch] space-y-4">
            {e.responses.map((c) => (
              <li key={c.text}>
                <span className="font-semibold">{c.actor}.</span> {c.text}
                <Cite ids={c.sourceIds} sources={e.sources} />
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {e.policy.length > 0 ? (
        <Section id="policy-heading" title="Related policy developments">
          <ul className="max-w-[70ch] space-y-4">
            {e.policy.map((c) => (
              <li key={c.text} className="grid gap-1 sm:grid-cols-[9rem_1fr]">
                <span className="text-sm text-ash">{c.date ?? "Date not established"}</span>
                <span>
                  {c.text}
                  <Cite ids={c.sourceIds} sources={e.sources} />
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {e.imagery.length > 0 ? (
        <Section id="imagery-heading" title="Satellite imagery">
          {e.imagery.map((img) => (
            <figure key={img.url} className="max-w-4xl">
              {/* eslint-disable-next-line @next/next/no-img-element -- external agency image, shown with its own credit */}
              <img src={img.url} alt={img.description} loading="lazy" className="w-full rounded-[var(--radius-panel)] border border-line" />
              <figcaption className="mt-2 text-sm text-ash">
                {img.description} Credit: {img.credit}. {img.licenceNote}{" "}
                {img.pageUrl ? (
                  <a href={img.pageUrl} rel="noopener noreferrer">
                    Image page
                  </a>
                ) : null}
              </figcaption>
            </figure>
          ))}
        </Section>
      ) : null}

      <SourceList sources={e.sources} />

      <nav aria-label="Other episodes" className="mt-12 flex flex-wrap justify-between gap-4 border-t border-line pt-6 text-sm">
        {prev ? <Link href={`/history/${prev.slug}`}>Earlier: {prev.title}</Link> : <span />}
        {next ? <Link href={`/history/${next.slug}`}>Later: {next.title}</Link> : null}
      </nav>
      <p className="mt-6 text-sm text-ash">
        Spotted an error? See the <Link href="/about#corrections">corrections policy</Link>.
      </p>
    </article>
  );
}
