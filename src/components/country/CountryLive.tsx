"use client";

import Link from "next/link";
import type { CountryCode } from "@/lib/domain/countries";
import type { HistoryResponse } from "@/lib/pipeline/service";
import { describeReading, formatObservedAt, freshnessFor } from "@/lib/ui/readings";
import { useApi, useNow } from "@/lib/ui/useApi";
import { useSnapshot } from "../live/LiveDashboard";
import { BandBadge, DemoBadge, FreshnessBadge } from "../ui/Badge";
import { ErrorState, LoadingBlock, Note } from "../ui/States";

/** Latest available readings for one country, from the shared snapshot. */
export function CountryLive({ code, name }: { code: CountryCode; name: string }) {
  const snap = useSnapshot();
  const now = useNow();
  const monthly = useApi<HistoryResponse>(
    code === "MY" ? "/api/history?provider=my-opendosm&station=my-opendosm:national&metric=concentration:PM2.5&period=P1M&from=2017-01-01&to=2030-12-31" : null,
  );

  if (snap.status === "loading") return <LoadingBlock label={`Loading readings for ${name}`} />;
  if (!snap.data) return <ErrorState title="Live readings could not be loaded" onRetry={snap.reload}>{snap.error}</ErrorState>;

  const s = snap.data;
  const rows = s.observations.filter((o) => o.countryCode === code && o.kind !== "weather");
  const stations = new Map(s.stations.map((x) => [x.id, x]));
  const latestMonth = monthly.status === "ready" ? monthly.data.observations.filter((o) => o.value !== null).at(-1) : undefined;

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <Note tone="warn">
          No live readings for {name} are available in the latest check. Either no documented source is connected yet, or the source did not
          respond. Nothing is estimated in their place.
        </Note>
      ) : (
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={`Latest readings in ${name} table`}>
          <table className="data-table min-w-[38rem]">
            <thead>
              <tr>
                <th scope="col">Station or region</th>
                <th scope="col">Measure</th>
                <th scope="col" className="num">
                  Value
                </th>
                <th scope="col">Category</th>
                <th scope="col">Reported</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => {
                const d = describeReading(o);
                const f = now ? freshnessFor(o, s.providers, now) : null;
                return (
                  <tr key={`${o.stationId}-${d.metricLabel}`}>
                    <td>
                      {stations.get(o.stationId)?.name ?? o.stationId}
                      {o.provenance === "demo" ? <span className="ml-2"><DemoBadge /></span> : null}
                    </td>
                    <td>{d.metricLabel}</td>
                    <td className="num whitespace-nowrap">
                      {d.valueText} <span className="text-ash">{d.isIndex ? "" : d.scaleLabel}</span>
                    </td>
                    <td>{d.band ? <BandBadge level={d.band.level} label={d.band.label} scaleName={d.band.scaleName} /> : <span className="text-dim">None published</span>}</td>
                    <td className="text-ash">
                      {formatObservedAt(o.observedAtUtc, o.countryCode)} {f ? <FreshnessBadge state={f.state} reason={f.reason} /> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {code === "MY" ? (
        <p className="text-sm text-ash measure">
          {latestMonth
            ? `Latest national monthly mean PM2.5 published on OpenDOSM: ${latestMonth.value} µg/m³ for ${latestMonth.original.timestamp.slice(0, 7)}. `
            : monthly.status === "error"
              ? "The OpenDOSM monthly series could not be retrieved just now. "
              : ""}
          <Link href="/data">Explore the monthly series</Link>.
        </p>
      ) : null}
      <p className="text-sm">
        <Link href={`/live`}>Open the live dashboard</Link>
        {" or "}
        <Link href={`/hotspots?country=${code}`}>see fire detections in {name}</Link>.
      </p>
    </div>
  );
}
