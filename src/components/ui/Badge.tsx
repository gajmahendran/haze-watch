import type { ReactNode } from "react";
import { FRESHNESS_LABEL, type FreshnessState } from "@/lib/domain/freshness";
import { bandColor, type BandLevel } from "@/lib/ui/readings";

type Tone = "neutral" | "warn" | "error" | "demo" | "ok";

const TONE: Record<Tone, string> = {
  neutral: "border-line-strong text-ash",
  ok: "border-band-1/60 text-smoke",
  warn: "border-warn/70 text-warn",
  error: "border-error/70 text-error",
  demo: "border-demo/80 text-demo",
};

export function Badge({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs leading-5 whitespace-nowrap ${TONE[tone]}`}
    >
      {children}
    </span>
  );
}

/** Category on a published scale. Colour plus the band's own words, never colour alone. */
export function BandBadge({ level, label, scaleName }: { level: BandLevel | null; label: string; scaleName?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-line-strong px-2 py-0.5 text-xs leading-5 text-smoke whitespace-nowrap"
      title={scaleName ? `${label} on the ${scaleName} scale` : label}
    >
      <span aria-hidden className="size-2.5 rounded-full" style={{ background: bandColor(level) }} />
      {label}
    </span>
  );
}

const FRESH_TONE: Record<FreshnessState, Tone> = { fresh: "ok", delayed: "warn", stale: "error", unknown: "neutral" };
const FRESH_GLYPH: Record<FreshnessState, string> = { fresh: "●", delayed: "◐", stale: "○", unknown: "?" };

export function FreshnessBadge({ state, reason }: { state: FreshnessState; reason?: string }) {
  return (
    <Badge tone={FRESH_TONE[state]} title={reason}>
      <span aria-hidden>{FRESH_GLYPH[state]}</span>
      {FRESHNESS_LABEL[state]}
    </Badge>
  );
}

export function DemoBadge() {
  return (
    <Badge tone="demo" title="Synthetic development data. Not a measurement.">
      Demo data
    </Badge>
  );
}

export function ConnectionBadge({ connected, label }: { connected: boolean; label?: string }) {
  return <Badge tone={connected ? "ok" : "warn"}>{label ?? (connected ? "Connected" : "Not connected")}</Badge>;
}
