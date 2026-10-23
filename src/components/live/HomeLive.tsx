"use client";

import Link from "next/link";
import { useMemo } from "react";
import { worstState, FRESHNESS_LABEL } from "@/lib/domain/freshness";
import { categoryFor } from "@/lib/domain/indices";
import type { IndexObservation, Snapshot } from "@/lib/domain/schemas";
import { formatInZone } from "@/lib/domain/time";
import { bandColor, describeReading, freshnessFor, type ViewMode } from "@/lib/ui/readings";
import { useNow } from "@/lib/ui/useApi";
import { HazeMap, type MapMarker } from "../map/Map";
import { ReadingStrip } from "../readings/ReadingStrip";
import { DemoBadge, FreshnessBadge } from "../ui/Badge";
import { ErrorState, LoadingBlock, Note } from "../ui/States";
import { LastUpdated, useSnapshot } from "./LiveDashboard";
import { observationForView } from "@/lib/ui/readings";

function realIndexReadings(s: Snapshot, indexId: "SG_PSI" | "MY_API"): IndexObservation[] {
  return s.observations.filter((o): o is IndexObservation => o.kind === "index" && o.indexId === indexId && o.value !== null);
}

/** Hero: the highest current Singapore 24-hour PSI region, if real data is available. */
export function HeroReading() {
  const snap = useSnapshot();
  const now = useNow();
  if (snap.status === "loading") return <LoadingBlock label="Loading the latest reading" />;
  if (!snap.data) {
    return (
      <ErrorState title="Live readings could not be loaded" onRetry={snap.reload}>
        {snap.error}
      </ErrorState>
    );
  }
  const s = snap.data;
  const real = realIndexReadings(s, "SG_PSI").filter((o) => o.provenance === "provider");
  const demo = realIndexReadings(s, "SG_PSI").filter((o) => o.provenance === "demo");
  const pool = real.length > 0 ? real : demo;
  const top = pool.reduce<IndexObservation | null>((m, o) => (m === null || (o.value ?? 0) > (m.value ?? 0) ? o : m), null);
  const station = top ? s.stations.find((x) => x.id === top.stationId) : null;

  return (
    <div>
      <LastUpdated snapshot={s} />
      {top && station ? (
        <div className="mt-5">
          <p className="text-sm text-ash">Highest regional reading in Singapore right now</p>
          <div className="mt-2">
            <ReadingStrip
              value={top.value}
              scale={{ kind: "index", indexId: "SG_PSI" }}
              metricLabel={`${describeReading(top).metricLabel}, ${station.name}`}
              unitLabel="Singapore PSI (index, no unit)"
              bandLabel={categoryFor("SG_PSI", top.value)?.label}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-ash">
            <span>Reading time {formatInZone(top.observedAtUtc, "Asia/Singapore")}</span>
            {now ? <FreshnessBadge state={freshnessFor(top, s.providers, now).state} reason={freshnessFor(top, s.providers, now).reason} /> : null}
            {top.provenance === "demo" ? <DemoBadge /> : null}
          </div>
          {top.provenance === "demo" ? (
            <div className="mt-3">
              <Note tone="demo">Singapore&apos;s live source is unreachable from this environment, so this is a labelled demo value.</Note>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-5">
          <Note tone="warn">No Singapore PSI reading is available right now. The source may be unreachable; nothing is shown in its place.</Note>
        </div>
      )}
      <p className="mt-5 text-sm text-ash measure">
        Malaysia&apos;s live Air Pollutant Index is published on{" "}
        <a href="https://eqms.doe.gov.my/apims/main" rel="noopener noreferrer">
          DOE&apos;s APIMS
        </a>
        , which has no documented public data access, so it is not mirrored here.
      </p>
    </div>
  );
}

/** Plain-language summary written only from real readings in the current snapshot. */
export function SituationLive() {
  const snap = useSnapshot();
  const now = useNow();
  const sentences = useMemo(() => {
    const s = snap.data;
    if (!s) return [];
    const out: string[] = [];
    const psi = realIndexReadings(s, "SG_PSI").filter((o) => o.provenance === "provider");
    if (psi.length > 0) {
      const counts = new Map<string, number>();
      for (const o of psi) {
        const label = categoryFor("SG_PSI", o.value)?.label ?? "Uncategorised";
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const parts = [...counts.entries()].map(([label, n]) => `${n} in the ${label} range`);
      const newest = psi.reduce((m, o) => (o.observedAtUtc > m ? o.observedAtUtc : m), psi[0]!.observedAtUtc);
      out.push(`Singapore, 24-hour PSI at ${formatInZone(newest, "Asia/Singapore")}: of ${psi.length} regions, ${parts.join(", ")}.`);
    }
    const pm = s.observations.filter((o) => o.provenance === "provider" && o.kind === "concentration" && o.pollutant === "PM2.5" && o.averagingPeriod === "PT1H" && o.value !== null);
    if (pm.length > 0) {
      const max = Math.max(...pm.map((o) => o.value as number));
      const min = Math.min(...pm.map((o) => o.value as number));
      out.push(`Singapore, 1-hour PM2.5 across regions: ${min} to ${max} µg/m³.`);
    }
    return out;
  }, [snap.data]);

  if (snap.status === "loading") return <LoadingBlock label="Loading the situation summary" />;
  if (!snap.data) return null;
  const freshness = now ? worstState(snap.data.observations.filter((o) => o.provenance === "provider" && o.kind !== "weather").map((o) => freshnessFor(o, snap.data!.providers, now).state)) : "unknown";

  return (
    <div className="space-y-2 text-base">
      {sentences.length > 0 ? (
        <>
          {sentences.map((t) => (
            <p key={t}>{t}</p>
          ))}
          <p className="text-sm text-ash">Generated automatically from official readings. Freshness: {FRESHNESS_LABEL[freshness].toLowerCase()}.</p>
        </>
      ) : (
        <p className="text-ash">No live official readings could be retrieved in the latest check, so there is no automatic summary right now.</p>
      )}
    </div>
  );
}

/** Regional map with three summary figures. */
export function HomeMapSection() {
  const snap = useSnapshot();
  const now = useNow();
  const view: ViewMode = "index";
  const markers: MapMarker[] = useMemo(() => {
    const s = snap.data;
    if (!s) return [];
    return s.stations.flatMap((st) => {
      if (st.latitude === null || st.longitude === null || st.providerId.endsWith("weather")) return [];
      const o = observationForView(s.observations, st.id, view);
      if (!o) return [];
      const d = describeReading(o);
      return [
        {
          id: st.id,
          lat: st.latitude,
          lon: st.longitude,
          text: o.value === null ? "–" : d.valueText,
          color: bandColor(d.band?.level ?? null),
          muted: o.value === null,
          shape: st.kind === "region_aggregate" ? "square" : "pill",
          title: `${st.name}: ${d.metricLabel} ${d.valueText} (${d.scaleLabel})${d.band ? `, ${d.band.label}` : ""}`,
        } satisfies MapMarker,
      ];
    });
  }, [snap.data]);

  const s = snap.data;
  const reporting = s ? new Set(s.observations.filter((o) => o.kind !== "weather" && o.value !== null).map((o) => o.stationId)).size : null;
  const connected = s ? s.providers.filter((p) => p.connection.status === "connected" && p.accessMethod !== "demo").length : null;
  const total = s ? s.providers.filter((p) => p.accessMethod !== "demo").length : null;
  const fresh = s && now ? worstState(s.observations.filter((o) => o.kind !== "weather").map((o) => freshnessFor(o, s.providers, now).state)) : "unknown";

  return (
    <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
      <HazeMap ariaLabel="Regional map of current readings. The live page lists the same readings in a table." markers={markers} fitTo={[[-8, 95], [21, 125]]} className="h-[24rem] lg:h-[30rem]" />
      <div className="grid content-start gap-6 border-l border-line pl-6">
      <dl className="grid content-start gap-6">
        <div>
          <dt className="text-sm text-ash">Stations and regions reporting</dt>
          <dd className="numeral text-4xl">{reporting ?? "–"}</dd>
          {s?.demoMode ? <dd className="mt-1"><DemoBadge /></dd> : null}
        </div>
        <div>
          <dt className="text-sm text-ash">Data freshness</dt>
          <dd className="mt-1">
            <FreshnessBadge state={fresh} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ash">Air quality sources connected</dt>
          <dd className="numeral text-4xl">
            {connected ?? "–"}
            <span className="text-xl text-ash"> of {total ?? "–"}</span>
          </dd>
          <dd className="mt-1 text-sm">
            <Link href="/about#sources">Source status</Link>
          </dd>
        </div>
      </dl>
        <p className="text-sm">
          <Link href="/live">Open the live dashboard</Link> for every station, both PM2.5 views and recent history.
        </p>
      </div>
    </div>
  );
}
