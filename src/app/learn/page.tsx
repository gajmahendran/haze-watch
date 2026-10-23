import type { Metadata } from "next";
import Link from "next/link";
import { Cite, SourceList } from "@/components/ui/Citations";
import { Note } from "@/components/ui/States";
import { loadEducation } from "@/lib/content/loader";
import type { EducationTopic } from "@/lib/content/schema";
import { INDEX_REGISTRY, SG_PM25_1H_GUIDE } from "@/lib/domain/indices";
import { bandColor } from "@/lib/ui/readings";

export const metadata: Metadata = {
  title: "Understanding haze: causes, PM2.5, indices and health",
  description:
    "What haze is, how peat fires produce it, PM2.5 and PM10, what PSI, API and AQI mean and why they differ, how wind carries smoke, and official health precautions.",
  alternates: { canonical: "/learn" },
};

const TITLES: Record<EducationTopic, string> = {
  "what-is-haze": "What haze is",
  "fire-and-peat": "How forest and peat fires make smoke",
  "pm25-vs-pm10": "PM2.5 and PM10",
  "index-meanings": "What PSI, API and AQI mean",
  "index-differences": "Why national indices differ",
  "weather-transport": "How wind and weather move smoke",
  "health-effects": "Health effects",
  precautions: "Precautions, from official guidance",
  "land-use-climate": "Land use and climate",
};

export default function LearnPage() {
  const edu = loadEducation();
  if (!edu) return <div className="wrap pt-10">Education content has not been written yet.</div>;
  const topics = edu.topics;

  return (
    <div className="wrap pt-10">
      <h1 className="text-3xl md:text-4xl">Understanding haze</h1>
      <p className="mt-4 max-w-[62ch] text-lg text-ash">
        Plain explanations with sources. This page is general information, not medical advice: follow your local health authority and your
        doctor, and remember that one index reading does not decide any individual&apos;s risk.
      </p>

      <div className="mt-10 grid grid-cols-1 gap-12 lg:grid-cols-[14rem_1fr]">
        <nav aria-label="On this page" className="lg:sticky lg:top-24 lg:self-start">
          <ol className="space-y-1.5 text-sm">
            {topics.map((t) => (
              <li key={t.topic}>
                <a href={`#${t.topic}`} className="no-underline hover:underline">
                  {TITLES[t.topic]}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0">
          {topics.map((t) => (
            <section key={t.topic} id={t.topic} aria-labelledby={`${t.topic}-h`} className="mb-14 scroll-mt-24">
              <h2 id={`${t.topic}-h`} className="text-2xl md:text-3xl">
                {TITLES[t.topic]}
              </h2>
              <div className="mt-4 prose-editorial">
                {t.facts.map((f) => (
                  <p key={f.text}>
                    {f.text}
                    <Cite ids={f.sourceIds} sources={edu.sources} prefix="learn" />
                  </p>
                ))}
              </div>

              {t.topic === "index-meanings" ? <IndexComparison /> : null}

              {t.officialGuidance.length > 0 ? (
                <div className="mt-5">
                  <p className="text-sm font-semibold">Official guidance</p>
                  <ul className="mt-1 space-y-1 text-sm">
                    {t.officialGuidance.map((g) => (
                      <li key={g.url}>
                        <a href={g.url} rel="noopener noreferrer">
                          {g.title}
                        </a>{" "}
                        <span className="text-ash">({g.publisher})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {t.topic === "land-use-climate" ? (
                <div className="mt-5">
                  <Note>Links between haze and biodiversity are not yet covered here from a source we have checked.</Note>
                </div>
              ) : null}
            </section>
          ))}
          <SourceList sources={edu.sources} prefix="learn" />
        </div>
      </div>
    </div>
  );
}

function IndexComparison() {
  const psi = INDEX_REGISTRY.SG_PSI;
  const api = INDEX_REGISTRY.MY_API;
  return (
    <div className="mt-8">
      <h3 className="text-xl">The scales side by side</h3>
      <p className="mt-1 text-sm text-ash measure">
        Shown next to each other so you can see the labels, not so you can convert between them. The same number on two scales is not the same air.
      </p>
      <div className="mt-4 grid gap-6 md:grid-cols-3">
        {[psi, api].map((def) => (
          <div key={def.id} className="border-t border-line-strong pt-3">
            <p className="font-display text-lg">{def.shortName}</p>
            <p className="text-xs text-ash">{def.agency}. Categories for the {def.categoryAveraging} value.</p>
            <ul className="mt-3 space-y-1.5 text-sm">
              {def.bands.map((b, i) => (
                <li key={b.label} className="flex items-center gap-2">
                  <span aria-hidden className="size-3 rounded-full" style={{ background: bandColor(b.level) }} />
                  <span className="w-20 tabular-nums text-ash">
                    {i === 0 ? 0 : (def.bands[i - 1]!.upTo ?? 0) + 1}
                    {b.upTo === null ? " and above" : `–${b.upTo}`}
                  </span>
                  {b.label}
                </li>
              ))}
            </ul>
            {!def.bandsVerifiedAgainstSource ? <p className="mt-2 text-xs text-warn">Provisional: not yet confirmed against the agency&apos;s own document.</p> : null}
          </div>
        ))}
        <div className="border-t border-line-strong pt-3">
          <p className="font-display text-lg">{SG_PM25_1H_GUIDE.name}</p>
          <p className="text-xs text-ash">A concentration in µg/m³, not an index. For the next hour&apos;s activities.</p>
          <ul className="mt-3 space-y-1.5 text-sm">
            {SG_PM25_1H_GUIDE.bands.map((b, i) => (
              <li key={b.label} className="flex items-center gap-2">
                <span aria-hidden className="size-3 rounded-full" style={{ background: bandColor(b.level) }} />
                <span className="w-20 tabular-nums text-ash">
                  {i === 0 ? 0 : (SG_PM25_1H_GUIDE.bands[i - 1]!.upTo ?? 0) + 1}
                  {b.upTo === null ? " and above" : `–${b.upTo}`}
                </span>
                {b.label}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <p className="mt-4 text-sm">
        Sources: <a href={psi.bandsSourceUrls[0]}>Singapore Ministry of Health</a>, <a href={api.bandsSourceUrls[0]}>RTM report of the DOE scale</a>.{" "}
        <Link href="/about#indices">How this site handles indices</Link>.
      </p>
    </div>
  );
}
