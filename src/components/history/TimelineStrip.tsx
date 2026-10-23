import Link from "next/link";
import type { HazeEvent } from "@/lib/content/schema";
import { SEVERITY_LABEL, SEVERITY_WEIGHT, STATUS_LABEL, yearsLabel } from "@/lib/ui/events";

/**
 * A horizontal year axis with one marker per documented episode. Marker height shows the
 * editorial severity rating; agenda items are drawn hollow. It is a real chronology, so position
 * along the axis carries meaning.
 */
export function TimelineStrip({ events, from = 1996, to = 2027 }: { events: HazeEvent[]; from?: number; to?: number }) {
  const span = to - from;
  const ticks = [2000, 2005, 2010, 2015, 2020, 2025];
  return (
    <div>
      <div className="relative hidden h-40 md:block" aria-hidden>
        <div className="absolute inset-x-0 bottom-8 border-t border-line-strong" />
        {ticks.map((y) => (
          <span key={y} className="absolute bottom-0 -translate-x-1/2 text-xs text-dim" style={{ left: `${((y - from) / span) * 100}%` }}>
            {y}
          </span>
        ))}
        {events.map((e) => {
          const w = SEVERITY_WEIGHT[e.severity];
          const left = ((e.yearStart + 0.5 - from) / span) * 100;
          return (
            <Link
              key={e.slug}
              href={`/history/${e.slug}`}
              tabIndex={-1}
              className="group absolute bottom-8 flex -translate-x-1/2 flex-col items-center no-underline"
              style={{ left: `${left}%` }}
            >
              <span className="mb-1 text-xs whitespace-nowrap text-ash group-hover:text-smoke">{yearsLabel(e)}</span>
              <span
                className={`w-3 rounded-t-sm ${w === 0 ? "border border-b-0 border-dashed border-ash" : "bg-smoke/85 group-hover:bg-lichen"}`}
                style={{ height: `${w === 0 ? 14 : 18 + w * 22}px` }}
              />
            </Link>
          );
        })}
      </div>
      <ol className="mt-2 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {events.map((e) => (
          <li key={e.slug} className="border-t border-line pt-3">
            <Link href={`/history/${e.slug}`} className="font-display text-lg">
              {e.title}
            </Link>
            <p className="text-sm text-ash">
              {SEVERITY_LABEL[e.severity]}. {STATUS_LABEL[e.status]}.
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
