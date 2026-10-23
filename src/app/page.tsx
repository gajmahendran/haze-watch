import Link from "next/link";
import { HomeTrends } from "@/components/data/HomeTrends";
import { TimelineStrip } from "@/components/history/TimelineStrip";
import { HeroReading, HomeMapSection, SituationLive } from "@/components/live/HomeLive";
import { Cite } from "@/components/ui/Citations";
import { ButtonLink } from "@/components/ui/Controls";
import { loadEducation, loadEvents, loadLibrary } from "@/lib/content/loader";
import { LIBRARY_TYPE_LABEL } from "@/lib/ui/library";


export default function Home() {
  const events = loadEvents();
  const current = events.find((e) => e.slug === "2026-haze-season");
  const library = loadLibrary().slice(0, 6);
  const education = loadEducation();
  const causes = education?.topics.find((t) => t.topic === "what-is-haze");
  const peat = education?.topics.find((t) => t.topic === "fire-and-peat");
  const weather = education?.topics.find((t) => t.topic === "weather-transport");

  return (
    <>
      <section className="wrap grid gap-10 pt-12 pb-16 lg:grid-cols-[1.15fr_1fr] lg:gap-16 lg:pt-16">
        <div>
          <h1 className="text-[clamp(2.6rem,6vw,4.5rem)] leading-[1.02]">Haze in Southeast Asia, measured and on the record.</h1>
          <p className="mt-6 max-w-[56ch] text-lg text-ash">
            Official air quality readings shown on the scales their agencies publish, satellite fire detections, and a sourced
            history of every major haze episode since 1997. Nothing is estimated to fill a gap.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/live">Check live air quality</ButtonLink>
            <ButtonLink href="/history" variant="quiet">
              Read the haze history
            </ButtonLink>
          </div>
        </div>
        <div className="self-start rounded-[var(--radius-panel)] border border-line bg-forest p-6">
          <HeroReading />
        </div>
      </section>

      <section aria-labelledby="situation-heading" className="border-y border-line bg-forest/50">
        <div className="wrap grid gap-10 py-12 lg:grid-cols-[1fr_1fr]">
          <div>
            <h2 id="situation-heading" className="text-2xl">
              Regional situation
            </h2>
            <div className="mt-4">
              <SituationLive />
            </div>
          </div>
          {current ? (
            <div>
              <h3 className="text-xl">
                <Link href={`/history/${current.slug}`}>{current.title}</Link>
              </h3>
              <p className="mt-3 prose-editorial text-[1.0625rem]">
                {current.summary}
                <Cite ids={current.summarySourceIds.slice(0, 3)} sources={current.sources} page={`/history/${current.slug}`} />
              </p>
              <p className="mt-3 text-sm text-ash">
                From our sourced episode record, last reviewed {current.lastReviewed}. Citations are on the{" "}
                <Link href={`/history/${current.slug}`}>episode page</Link>.
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="map-heading" className="wrap py-16">
        <h2 id="map-heading" className="text-3xl">
          Across the region now
        </h2>
        <p className="mt-2 max-w-[62ch] text-ash">
          Each marker shows the latest value on its country&apos;s own index. Colour follows that index&apos;s published bands, and the number is
          always printed on the marker.
        </p>
        <div className="mt-8">
          <HomeMapSection />
        </div>
      </section>

      <section aria-labelledby="episodes-heading" className="wrap py-12">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 id="episodes-heading" className="text-3xl">
              Major haze episodes
            </h2>
            <p className="mt-2 max-w-[62ch] text-ash">
              Marker height shows our severity rating, based on what the cited sources report. Dashed markers are years still under research,
              not confirmed crises.
            </p>
          </div>
          <Link href="/history">Full timeline and filters</Link>
        </div>
        <div className="mt-8">
          <TimelineStrip events={events} />
        </div>
      </section>

      <section aria-labelledby="trends-heading" className="wrap py-12">
        <h2 id="trends-heading" className="text-3xl">
          Recent and long-run trends
        </h2>
        <div className="mt-6">
          <HomeTrends />
        </div>
      </section>

      <section aria-labelledby="causes-heading" className="border-y border-line bg-forest/50">
        <div className="wrap py-14">
          <h2 id="causes-heading" className="text-3xl">
            Where haze comes from
          </h2>
          <div className="mt-8 grid gap-10 md:grid-cols-3">
            {[
              { title: "Smoke from forest and peat fires", topic: causes, fact: causes?.facts[1], anchor: "what-is-haze" },
              { title: "Peat keeps burning underground", topic: peat, fact: peat?.facts[0], anchor: "fire-and-peat" },
              { title: "The wind decides who breathes it", topic: weather, fact: weather?.facts[2], anchor: "weather-transport" },
            ].map((c) =>
              c.fact && education ? (
                <div key={c.anchor}>
                  <h3 className="text-xl">{c.title}</h3>
                  <p className="mt-2 text-ash">
                    {c.fact.text}
                    <Cite ids={c.fact.sourceIds} sources={education.sources} page="/learn" prefix="learn" />
                  </p>
                  <p className="mt-2 text-sm">
                    <Link href={`/learn#${c.anchor}`}>Read more</Link>
                  </p>
                </div>
              ) : null,
            )}
          </div>
          <p className="mt-6 text-xs text-dim">Citation numbers refer to the source list on the Learn page.</p>
        </div>
      </section>

      <section aria-labelledby="library-heading" className="wrap py-14">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="library-heading" className="text-3xl">
            Recent reports and announcements
          </h2>
          <Link href="/research">Search the research library</Link>
        </div>
        <p className="mt-2 text-sm text-ash">A curated list, checked by hand. This is not a live news feed.</p>
        <ul className="mt-6 divide-y divide-line border-y border-line">
          {library.map((r) => (
            <li key={r.id} className="grid gap-1 py-4 md:grid-cols-[9rem_1fr]">
              <span className="text-sm text-ash">{r.publishedDate}</span>
              <span>
                <a href={r.url} rel="noopener noreferrer" target="_blank" className="font-display text-lg">
                  {r.title}
                </a>
                <span className="block text-sm text-ash">
                  {r.publisher}. {LIBRARY_TYPE_LABEL[r.type]}.
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
