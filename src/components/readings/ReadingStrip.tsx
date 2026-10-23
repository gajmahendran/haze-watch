import { INDEX_REGISTRY, SG_PM25_1H_GUIDE, type IndexId } from "@/lib/domain/indices";
import { bandColor, type BandLevel } from "@/lib/ui/readings";

/**
 * The signature element: a large numeral locked to its scale, with the scale's published bands
 * drawn underneath and a marker showing where the value sits. The bar is drawn from the scale's
 * own thresholds, so a PSI strip and a PM2.5 strip can never look like the same ruler.
 */

interface Segment {
  from: number;
  to: number;
  label: string;
  level: BandLevel;
}

function indexSegments(indexId: IndexId): Segment[] {
  const bands = INDEX_REGISTRY[indexId].bands;
  let from = 0;
  return bands.map((b) => {
    const to = b.upTo ?? 400;
    const seg = { from, to, label: b.label, level: b.level };
    from = to;
    return seg;
  });
}

function pm25Segments(): Segment[] {
  let from = 0;
  return SG_PM25_1H_GUIDE.bands.map((b) => {
    const to = b.upTo ?? 330;
    const seg = { from, to, label: b.label.replace(/^Band \d \((.*)\)$/, "$1"), level: b.level };
    from = to;
    return seg;
  });
}

export function ReadingStrip({
  value,
  scale,
  metricLabel,
  unitLabel,
  bandLabel,
  size = "large",
}: {
  value: number | null;
  scale: { kind: "index"; indexId: IndexId } | { kind: "sg_pm25_1h" } | { kind: "none" };
  metricLabel: string;
  unitLabel: string;
  bandLabel?: string | null;
  size?: "large" | "medium";
}) {
  const segments = scale.kind === "index" ? indexSegments(scale.indexId) : scale.kind === "sg_pm25_1h" ? pm25Segments() : [];
  const max = segments.at(-1)?.to ?? 0;
  const pos = value === null || max === 0 ? null : Math.min(100, (value / max) * 100);
  const numeralSize = size === "large" ? "text-[clamp(4rem,12vw,6.5rem)]" : "text-[clamp(2.75rem,7vw,4rem)]";

  return (
    <figure className="w-full">
      <div className="flex items-end gap-4">
        <span className={`numeral ${numeralSize} leading-[0.85]`}>{value === null ? "—" : value}</span>
        <figcaption className="pb-1.5 text-sm leading-snug">
          <span className="block text-smoke">{metricLabel}</span>
          <span className="block text-ash">{unitLabel}</span>
          {bandLabel ? <span className="mt-0.5 block font-semibold text-smoke">{bandLabel}</span> : null}
        </figcaption>
      </div>
      {segments.length > 0 ? (
        <div className="mt-4" aria-hidden>
          <div className="relative flex h-2 overflow-visible rounded-full">
            {segments.map((s, i) => (
              <span
                key={s.label}
                className={`h-full ${i === 0 ? "rounded-l-full" : ""} ${i === segments.length - 1 ? "rounded-r-full" : ""}`}
                style={{ width: `${((s.to - s.from) / max) * 100}%`, background: bandColor(s.level), opacity: 0.85 }}
              />
            ))}
            {pos !== null ? (
              <span className="absolute -top-1.5 h-5 w-[3px] -translate-x-1/2 rounded bg-smoke ring-2 ring-ground" style={{ left: `${pos}%` }} />
            ) : null}
          </div>
          <div className="relative mt-1.5 flex text-[11px] text-dim">
            {segments.map((s) => (
              <span key={s.label} className="truncate pr-1" style={{ width: `${((s.to - s.from) / max) * 100}%` }}>
                {s.label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </figure>
  );
}
