import { connection } from "next/server";
import { z } from "zod";
import { clientKey, jsonError, parseQuery, serverEnv, takeToken, tooManyRequests } from "@/lib/api/guard";
import { exportFilename, observationsToCsv } from "@/lib/domain/csv";
import { AVERAGING_PERIODS } from "@/lib/domain/schemas";
import { getAggregate, getHistory, historyCatalogue, HistoryRequestError } from "@/lib/pipeline/service";
import { toCsv } from "@/lib/domain/csv";

const dateSchema = z.iso.date();

const querySchema = z.object({
  provider: z.string().min(1).max(64),
  station: z.string().min(1).max(128),
  metric: z.string().regex(/^(index|concentration|weather):[A-Za-z0-9._]+$/),
  period: z.enum(AVERAGING_PERIODS),
  from: dateSchema,
  to: dateSchema,
  format: z.enum(["json", "csv"]).default("json"),
  aggregate: z.enum(["none", "day", "month"]).default("none"),
});

/**
 * GET /api/history?provider=&station=&metric=&period=&from=&to=&format=json|csv
 * GET /api/history            (no parameters) returns the catalogue of available series.
 */
export async function GET(request: Request) {
  await connection();
  const url = new URL(request.url);
  const env = serverEnv();
  if (url.searchParams.size === 0) {
    return Response.json({ catalogue: historyCatalogue(env) }, { headers: { "cache-control": "public, s-maxage=300" } });
  }
  if (!takeToken(`history:${clientKey(request.headers)}`, 20, 20)) return tooManyRequests();

  const q = parseQuery(url, querySchema);
  if (!q.ok) return q.response;

  try {
    if (q.data.aggregate !== "none") {
      const agg = await getAggregate(
        { env },
        { providerId: q.data.provider, stationId: q.data.station, metricKey: q.data.metric, averagingPeriod: q.data.period, from: q.data.from, to: q.data.to, granularity: q.data.aggregate },
      );
      if (q.data.format === "csv") {
        const names = new Map(agg.stations.map((s) => [s.id, s.name] as const));
        const rows = agg.series.flatMap((s) => s.buckets.map((b) => ({ stationId: s.stationId, ...b })));
        const csv = toCsv(
          rows,
          [
            { header: "station_id", value: (r) => r.stationId },
            { header: "station_name", value: (r) => names.get(r.stationId) },
            { header: agg.granularity === "day" ? "local_date" : "local_month", value: (r) => r.key },
            { header: "timezone", value: () => agg.zone },
            { header: "metric", value: () => agg.metricKey },
            { header: "source_averaging_period", value: () => agg.averagingPeriod },
            { header: "readings", value: (r) => r.count },
            { header: "missing", value: (r) => r.missing },
            { header: "expected", value: (r) => r.expected },
            { header: "incomplete", value: (r) => r.incomplete },
            { header: "mean", value: (r) => r.mean },
            { header: "min", value: (r) => r.min },
            { header: "max", value: (r) => r.max },
            { header: "peak_at_utc", value: (r) => r.peakAtUtc },
            { header: "source", value: () => agg.provider.operator },
          ],
          { bom: true },
        );
        const name = exportFilename({ scope: `${q.data.station}-${q.data.metric}-${q.data.aggregate}-summary`, from: q.data.from, to: q.data.to, demo: agg.provider.accessMethod === "demo" });
        return new Response(csv, {
          headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
        });
      }
      return Response.json(agg, { headers: { "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
    }
    const history = await getHistory(
      { env },
      { providerId: q.data.provider, stationId: q.data.station, metricKey: q.data.metric, averagingPeriod: q.data.period, from: q.data.from, to: q.data.to },
    );
    if (q.data.format === "csv") {
      const stations = new Map(history.stations.map((s) => [s.id, s] as const));
      const demo = history.observations.some((o) => o.provenance === "demo");
      const csv = observationsToCsv(history.observations, stations, { bom: true });
      const name = exportFilename({ scope: `${q.data.station}-${q.data.metric}-${q.data.period}`, from: q.data.from, to: q.data.to, demo });
      return new Response(csv, {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${name}"`,
          "cache-control": "no-store",
        },
      });
    }
    return Response.json(history, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch (error) {
    if (error instanceof HistoryRequestError) return jsonError(error.status, error.message);
    console.error("[api/history]", error);
    return jsonError(502, "History could not be retrieved from the source.");
  }
}
