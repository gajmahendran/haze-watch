"use client";

import type { PsiBandDaysResponse } from "@/lib/pipeline/service";
import { formatInZone } from "@/lib/domain/time";
import { useApi } from "@/lib/ui/useApi";
import { bandColor } from "@/lib/ui/readings";
import { TimeSeriesChart } from "../charts/TimeSeriesChart";
import { ErrorState, LoadingBlock, Note } from "../ui/States";

const REGION: Record<string, string> = { north: "North", south: "South", east: "East", west: "West", central: "Central" };

/**
 * Days per year on which Singapore's 24-hour PSI reached each band, from NEA's archive.
 * A derived count: the method is printed with it.
 */
export function PsiBandDays({ compact = false }: { compact?: boolean }) {
  const r = useApi<PsiBandDaysResponse>("/api/insights/psi-days");
  if (r.status === "loading") return <LoadingBlock label="Loading NEA's historical PSI" />;
  if (r.status === "error" && !r.data) {
    return (
      <ErrorState title="NEA's historical PSI could not be retrieved" onRetry={r.reload}>
        {r.error}
      </ErrorState>
    );
  }
  const d = r.data!;
  const partial = d.years.filter((y) => y.daysCovered < 360).map((y) => y.year);
  const series = [
    { id: "u", label: "Unhealthy or worse (101+)", color: bandColor(3), points: d.years.map((y) => ({ t: String(y.year), v: y.unhealthyOrWorse })) },
    { id: "vu", label: "Very unhealthy or worse (201+)", color: bandColor(4), points: d.years.map((y) => ({ t: String(y.year), v: y.veryUnhealthyOrWorse })) },
    { id: "h", label: "Hazardous (301+)", color: bandColor(5), points: d.years.map((y) => ({ t: String(y.year), v: y.hazardous })) },
  ];

  return (
    <div>
      <TimeSeriesChart
        kind="bar"
        height={compact ? 260 : 320}
        zone="Asia/Singapore"
        tickFormat="raw"
        unitLabel="days"
        series={series}
        ariaLabel="Days per year on which any Singapore region's 24-hour PSI reached the Unhealthy, Very unhealthy or Hazardous band"
      />
      <p className="mt-3 text-sm text-ash measure">
        {d.method} Archive coverage: {d.coverage.first ? formatInZone(d.coverage.first, "Asia/Singapore") : "unknown"} to{" "}
        {d.coverage.last ? formatInZone(d.coverage.last, "Asia/Singapore") : "unknown"}.
        {partial.length ? ` Partial years: ${partial.join(", ")}.` : ""}
      </p>
      {!compact ? (
        <div className="mt-4 overflow-x-auto" tabIndex={0} role="region" aria-label="PSI band days by year table">
          <table className="data-table min-w-[40rem]">
            <caption className="sr-only">Days per year in each PSI band, Singapore</caption>
            <thead>
              <tr>
                <th scope="col">Year</th>
                <th scope="col" className="num">
                  Days covered
                </th>
                <th scope="col" className="num">
                  Unhealthy or worse
                </th>
                <th scope="col" className="num">
                  Very unhealthy or worse
                </th>
                <th scope="col" className="num">
                  Hazardous
                </th>
                <th scope="col">Highest 24-hour PSI</th>
              </tr>
            </thead>
            <tbody>
              {d.years.map((y) => (
                <tr key={y.year}>
                  <td>
                    {y.year}
                    {y.daysCovered < 360 ? <span className="text-dim"> (partial)</span> : null}
                  </td>
                  <td className="num">{y.daysCovered}</td>
                  <td className="num">{y.unhealthyOrWorse}</td>
                  <td className="num">{y.veryUnhealthyOrWorse}</td>
                  <td className="num">{y.hazardous}</td>
                  <td>
                    {y.peak === null ? (
                      <span className="text-dim">No value</span>
                    ) : (
                      <>
                        {y.peak} <span className="text-ash">({REGION[y.peakRegion ?? ""] ?? y.peakRegion}, {y.peakAtUtc ? formatInZone(y.peakAtUtc, "Asia/Singapore") : ""})</span>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="mt-3">
        <Note>
          The archive starts in April 2014, after the 2013 record, and is published in monthly batches, so the latest weeks come from the live
          feed instead.
        </Note>
      </div>
    </div>
  );
}
