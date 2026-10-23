"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { WHO_2021_GUIDELINES } from "@/lib/domain/indices";
import { localDateKey } from "@/lib/domain/time";
import type { HistoryResponse } from "@/lib/pipeline/service";
import { useApi, useNow } from "@/lib/ui/useApi";
import { ChartTable, TimeSeriesChart, type ChartSeries } from "../charts/TimeSeriesChart";
import { PsiBandDays } from "../history/PsiBandDays";
import { Segmented } from "../ui/Controls";
import { ErrorState, LoadingBlock, Note } from "../ui/States";

type Tab = "sg_psi" | "sg_days" | "my_pm25";

export function HomeTrends() {
  const [tab, setTab] = useState<Tab>("sg_psi");
  const now = useNow(300_000);
  const url = useMemo(() => {
    if (!now) return null;
    if (tab === "sg_days") return null;
    if (tab === "my_pm25") return "/api/history?provider=my-opendosm&station=my-opendosm:national&metric=concentration:PM2.5&period=P1M&from=2017-01-01&to=2030-12-31";
    const to = localDateKey(now.toISOString(), "Asia/Singapore");
    const from = localDateKey(new Date(now.getTime() - 2 * 86_400_000).toISOString(), "Asia/Singapore");
    return `/api/history?provider=sg-nea-air&station=all&metric=index:SG_PSI&period=PT24H&from=${from}&to=${to}`;
  }, [tab, now]);
  const h = useApi<HistoryResponse>(url);

  const series: ChartSeries[] = useMemo(() => {
    if (h.status !== "ready") return [];
    const byStation = new Map<string, ChartSeries>();
    for (const o of h.data.observations) {
      const st = h.data.stations.find((s) => s.id === o.stationId);
      const s = byStation.get(o.stationId) ?? { id: o.stationId.replace(/[^a-z0-9]/gi, "_"), label: st?.name.replace(", Singapore", "") ?? o.stationId, points: [] };
      s.points.push({ t: o.observedAtUtc, v: o.value });
      byStation.set(o.stationId, s);
    }
    return [...byStation.values()];
  }, [h]);

  const isPsi = tab === "sg_psi";
  return (
    <div>
      <Segmented
        label="Series"
        hideLabel
        value={tab}
        onChange={setTab}
        options={[
          { value: "sg_psi", label: "Singapore, 24-hour PSI, last 3 days" },
          { value: "sg_days", label: "Singapore, unhealthy days since 2014" },
          { value: "my_pm25", label: "Malaysia, PM2.5 national monthly mean" },
        ]}
      />
      {tab === "sg_days" ? (
        <div className="mt-5">
          <PsiBandDays compact />
        </div>
      ) : null}
      <div className={`mt-5 ${tab === "sg_days" ? "hidden" : ""}`}>
        {tab !== "sg_days" && h.status === "loading" ? <LoadingBlock label="Loading history" /> : null}
        {h.status === "error" ? (
          <ErrorState title="This history could not be retrieved" onRetry={h.reload}>
            {h.error}
          </ErrorState>
        ) : null}
        {h.status === "ready" && series.length === 0 ? <Note>The source returned no readings for this period.</Note> : null}
        {h.status === "ready" && series.length > 0 ? (
          <>
            <TimeSeriesChart
              series={series}
              zone={isPsi ? "Asia/Singapore" : "Asia/Kuala_Lumpur"}
              unitLabel={isPsi ? "PSI" : "µg/m³"}
              tickFormat={isPsi ? "datetime" : "month"}
              ariaLabel={isPsi ? "24-hour PSI by Singapore region over the last three days" : "Malaysia national monthly mean PM2.5"}
            />
            <ChartTable series={series} zone={isPsi ? "Asia/Singapore" : "Asia/Kuala_Lumpur"} unitLabel={isPsi ? "PSI" : "µg/m³"} caption="Data behind the chart" />
            <p className="mt-3 text-sm text-ash measure">
              {isPsi
                ? "Hourly values of the rolling 24-hour PSI from NEA via data.gov.sg. Gaps are hours the source did not report."
                : `National monthly means computed by DOE and DOSM from hourly station data (OpenDOSM, CC BY 4.0). For scale, WHO's 2021 annual PM2.5 guideline is ${WHO_2021_GUIDELINES.pm25.annual} µg/m³; a monthly mean is not directly comparable with an annual guideline.`}{" "}
              <Link href="/data">Explore more in the data explorer</Link>.
            </p>
          </>
        ) : null}
      </div>
    </div>
  );
}
