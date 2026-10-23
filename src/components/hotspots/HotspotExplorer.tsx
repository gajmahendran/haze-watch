"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { COUNTRIES, countryName, getCountry, isCountryCode } from "@/lib/domain/countries";
import { assessFreshness } from "@/lib/domain/freshness";
import type { Hotspot, HotspotResponse } from "@/lib/domain/schemas";
import { formatUtc } from "@/lib/domain/time";
import { useApi, useNow } from "@/lib/ui/useApi";
import { TimeSeriesChart } from "../charts/TimeSeriesChart";
import { HazeMap, type MapPoint } from "../map/Map";
import { DemoBadge, FreshnessBadge } from "../ui/Badge";
import { InfoTip, Segmented, Select } from "../ui/Controls";
import { EmptyState, ErrorState, LoadingBlock, Note } from "../ui/States";

type Confidence = "all" | "nominal_high" | "high";

const CONF_OPACITY: Record<string, number> = { low: 0.3, l: 0.3, nominal: 0.6, n: 0.6, high: 0.9, h: 0.9 };

function radius(frp: number | null): number {
  if (frp === null) return 3;
  return Math.min(9, 2.5 + Math.log10(1 + frp) * 3);
}

function gibsUrl(date: string): string {
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;
}

export function HotspotExplorer() {
  const params = useSearchParams();
  const initialCountry = params.get("country");
  const [days, setDays] = useState<"1" | "2" | "7">("1");
  const [country, setCountry] = useState(initialCountry && isCountryCode(initialCountry) ? initialCountry : "all");
  const [confidence, setConfidence] = useState<Confidence>("all");
  const [unassigned, setUnassigned] = useState(false);
  const [imagery, setImagery] = useState(false);
  const now = useNow(60_000);
  const imageryDate = now ? new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10) : null;

  const url = `/api/hotspots?days=${days}&confidence=${confidence}${country === "all" ? `&unassigned=${unassigned}` : `&country=${country}`}`;
  const res = useApi<{ feeds: HotspotResponse[] }>(url, { intervalMs: 15 * 60_000 });

  const feeds = useMemo(() => res.data?.feeds ?? [], [res.data]);
  const all: Hotspot[] = useMemo(() => feeds.flatMap((f) => f.hotspots), [feeds]);
  const points: MapPoint[] = useMemo(
    () =>
      all.map((h) => ({
        id: h.id,
        lat: h.latitude,
        lon: h.longitude,
        radius: radius(h.frpMegawatts),
        color: h.provenance === "demo" ? "#c9a0dc" : "#e07a4f",
        opacity: CONF_OPACITY[(h.confidenceRaw ?? "").toLowerCase()] ?? 0.5,
        tooltip: `${h.provenance === "demo" ? "DEMO " : ""}Thermal anomaly, ${formatUtc(h.acquiredAtUtc)}${h.confidenceRaw ? `, confidence ${h.confidenceRaw}` : ""}${h.frpMegawatts !== null ? `, FRP ${h.frpMegawatts} MW` : ""}`,
      })),
    [all],
  );
  const fitTo = useMemo<[[number, number], [number, number]] | null>(() => {
    if (country === "all") return [[-11, 92], [28.5, 141]];
    const c = getCountry(country as (typeof COUNTRIES)[number]["code"]);
    return [[c.bbox[1], c.bbox[0]], [c.bbox[3], c.bbox[2]]];
  }, [country]);

  const byCountry = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of all) m.set(h.countryCode ?? "none", (m.get(h.countryCode ?? "none") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);
  const top = useMemo(() => [...all].sort((a, b) => (b.frpMegawatts ?? -1) - (a.frpMegawatts ?? -1)).slice(0, 25), [all]);

  return (
    <div className="mt-8 space-y-8">
      <div className="grid gap-4 md:grid-cols-[auto_auto_1fr_auto] md:items-end">
        <Segmented
          label="Time window"
          value={days}
          onChange={setDays}
          options={[
            { value: "1", label: "24 hours" },
            { value: "2", label: "48 hours" },
            { value: "7", label: "7 days" },
          ]}
        />
        <Segmented
          label="Detection confidence"
          value={confidence}
          onChange={setConfidence}
          options={[
            { value: "all", label: "All" },
            { value: "nominal_high", label: "Nominal and high" },
            { value: "high", label: "High only" },
          ]}
        />
        <Select label="Country (by land boundary)" value={country} onChange={setCountry}>
          <option value="all">All covered countries</option>
          {COUNTRIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </Select>
        <div className="flex flex-col gap-2 text-sm">
          <label className={`flex items-center gap-2 ${country !== "all" ? "opacity-50" : ""}`}>
            <input type="checkbox" checked={unassigned} disabled={country !== "all"} onChange={(e) => setUnassigned(e.target.checked)} />
            Include offshore and other areas
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={imagery} onChange={(e) => setImagery(e.target.checked)} />
            Satellite image ({imageryDate ?? "yesterday"})
          </label>
        </div>
      </div>

      {res.status === "loading" ? <LoadingBlock label="Loading fire detections" /> : null}
      {res.status === "error" && !res.data ? (
        <ErrorState title="Fire detections could not be loaded" onRetry={res.reload}>
          {res.error}
        </ErrorState>
      ) : null}

      {res.data ? (
        <>
          <div className="space-y-2">
            {feeds.map((f) => {
              const fr = now && f.latestAcquiredAtUtc ? assessFreshness({ observedAtUtc: f.latestAcquiredAtUtc, expectedIntervalMinutes: f.provider.expectedIntervalMinutes, now }) : null;
              return (
                <div key={f.provider.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="font-semibold">{f.provider.name}</span>
                  {f.demoMode && f.provider.accessMethod === "demo" ? <DemoBadge /> : null}
                  <span className="text-ash">
                    {f.totalMatching.toLocaleString("en-GB")} detections match.{" "}
                    {f.latestAcquiredAtUtc ? `Most recent ${formatUtc(f.latestAcquiredAtUtc)}.` : "No detections retrieved."}
                  </span>
                  {fr ? <FreshnessBadge state={fr.state} reason={fr.reason} /> : null}
                </div>
              );
            })}
            {feeds.flatMap((f) => f.warnings.filter((w) => !w.includes("demo mode")).map((w) => <Note key={w} tone="warn">{w}</Note>))}
            {feeds.some((f) => f.truncated) ? (
              <Note>The map shows the {all.length.toLocaleString("en-GB")} detections with the highest radiative power. Totals above include all matches.</Note>
            ) : null}
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.7fr_1fr]">
            <div>
              <HazeMap
                ariaLabel="Map of satellite fire detections. A table of the strongest detections follows."
                points={points}
                fitTo={fitTo}
                imagery={
                  imagery && imageryDate
                    ? { url: gibsUrl(imageryDate), attribution: "Imagery: NASA EOSDIS GIBS, VIIRS Suomi NPP corrected reflectance", maxNativeZoom: 9, label: "True colour" }
                    : null
                }
                className="h-[28rem] lg:h-[36rem]"
              />
              <p className="mt-2 text-xs text-dim">
                Dot size follows fire radiative power; stronger opacity means higher detection confidence. One colour is used for all detections:
                colour on this site is reserved for air quality.
              </p>
            </div>
            <div className="space-y-6">
              <section aria-labelledby="what-heading" className="rounded-[var(--radius-panel)] border border-line bg-forest p-5 text-sm">
                <h2 id="what-heading" className="text-xl">
                  What a dot means
                </h2>
                <dl className="mt-3 space-y-3">
                  <div>
                    <dt className="font-semibold">Thermal anomaly (shown here)</dt>
                    <dd className="text-ash">A 375 m pixel that was hotter than its surroundings when a satellite passed. Often a fire, but it can be a flare, industrial heat or a false alarm.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Confirmed fire</dt>
                    <dd className="text-ash">Needs confirmation on the ground or by agencies. Not shown here.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Burned area</dt>
                    <dd className="text-ash">Mapped after the fact from imagery. A separate product, not shown here.</dd>
                  </div>
                  <div>
                    <dt className="font-semibold">Cause or responsibility</dt>
                    <dd className="text-ash">
                      Cannot be read from a detection. This site never attributes a fire to a company, landowner or person because of where a
                      detection falls.
                    </dd>
                  </div>
                </dl>
              </section>
              <section aria-labelledby="bycountry-heading">
                <h2 id="bycountry-heading" className="text-xl">
                  Detections by country <InfoTip label="About country labels">Countries are assigned with Natural Earth land boundaries. Points near borders or coasts can be labelled wrongly or not at all.</InfoTip>
                </h2>
                {byCountry.length === 0 ? (
                  <p className="mt-2 text-sm text-ash">None in this selection.</p>
                ) : (
                  <table className="data-table mt-2">
                    <tbody>
                      {byCountry.map(([code, n]) => (
                        <tr key={code}>
                          <td>{code === "none" ? "Offshore or outside covered countries" : countryName(code as Hotspot["countryCode"] & string)}</td>
                          <td className="num">{n.toLocaleString("en-GB")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          </div>

          <section aria-labelledby="daily-heading">
            <h2 id="daily-heading" className="text-2xl">
              Daily detections
            </h2>
            <p className="mt-1 text-sm text-ash measure">
              Counts by UTC date of acquisition. Detection counts depend on cloud cover and satellite passes, so a low count can mean the sensors
              could not see the ground.
            </p>
            {feeds.every((f) => f.daily.every((d) => d.count === 0)) ? (
              <div className="mt-4">
                <EmptyState title="No detections in this window">Try a longer window or another country.</EmptyState>
              </div>
            ) : (
              <TimeSeriesChart
                kind="bar"
                height={240}
                zone="UTC"
                tickFormat="raw"
                unitLabel="detections"
                series={feeds.map((f) => ({ id: f.provider.id.replace(/-/g, "_"), label: f.provider.name, points: f.daily.map((d) => ({ t: d.date, v: d.count })) }))}
                ariaLabel="Daily count of satellite fire detections"
              />
            )}
          </section>

          <section aria-labelledby="top-heading">
            <h2 id="top-heading" className="text-2xl">
              Strongest detections
            </h2>
            {top.length === 0 ? (
              <p className="mt-2 text-sm text-ash">None in this selection.</p>
            ) : (
              <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label="Strongest detections table">
                <table className="data-table min-w-[44rem]">
                  <thead>
                    <tr>
                      <th scope="col">Acquired (UTC)</th>
                      <th scope="col">Position</th>
                      <th scope="col">Country label</th>
                      <th scope="col">Satellite</th>
                      <th scope="col">Confidence</th>
                      <th scope="col" className="num">
                        FRP (MW)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {top.map((h) => (
                      <tr key={h.id}>
                        <td>{formatUtc(h.acquiredAtUtc)}</td>
                        <td>
                          {h.latitude.toFixed(3)}, {h.longitude.toFixed(3)}
                        </td>
                        <td>{h.countryCode ? countryName(h.countryCode) : "None"}</td>
                        <td>
                          {h.satellite ?? "Unknown"}
                          {h.provenance === "demo" ? <span className="ml-2"><DemoBadge /></span> : null}
                        </td>
                        <td>{h.confidenceRaw ?? "Not supplied"}</td>
                        <td className="num">{h.frpMegawatts ?? "–"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <Note>
            Peatland and forest cover layers are not shown yet: we have not confirmed a regional dataset with a clear licence. Imagery is NASA&apos;s
            daily true-colour mosaic and may show cloud. Source: <a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a>.{" "}
            <Link href="/about#sources">How this feed is used</Link>.
          </Note>
        </>
      ) : null}
    </div>
  );
}
