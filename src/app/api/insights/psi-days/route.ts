import { connection } from "next/server";
import { clientKey, jsonError, serverEnv, takeToken, tooManyRequests } from "@/lib/api/guard";
import { describeError } from "@/lib/pipeline/ingest";
import { getPsiBandDays } from "@/lib/pipeline/service";

/**
 * GET /api/insights/psi-days
 * Days per year on which any Singapore region's 24-hour PSI reached the Unhealthy, Very unhealthy
 * or Hazardous band, calculated from NEA's historical dataset. The method travels with the data.
 */
export async function GET(request: Request) {
  await connection();
  if (!takeToken(`insights:${clientKey(request.headers)}`, 20, 20)) return tooManyRequests();
  try {
    const data = await getPsiBandDays({ env: serverEnv() });
    return Response.json(data, { headers: { "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400" } });
  } catch (error) {
    return jsonError(502, `NEA's historical PSI dataset could not be retrieved (${describeError(error).message}). No figures are shown in its place.`);
  }
}
