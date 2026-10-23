import { connection } from "next/server";
import { z } from "zod";
import { clientKey, jsonError, parseQuery, serverEnv, takeToken, tooManyRequests } from "@/lib/api/guard";
import { COUNTRY_CODES } from "@/lib/domain/countries";
import { getHotspots } from "@/lib/pipeline/service";

const querySchema = z.object({
  days: z.coerce.number().int().min(1).max(7).default(1),
  country: z.enum(COUNTRY_CODES).optional(),
  confidence: z.enum(["all", "nominal_high", "high"]).default("all"),
  unassigned: z.enum(["true", "false"]).default("false"),
});

/** GET /api/hotspots?days=1..7&country=MY&confidence=all|nominal_high|high&unassigned=true|false */
export async function GET(request: Request) {
  await connection();
  if (!takeToken(`hotspots:${clientKey(request.headers)}`, 30, 30)) return tooManyRequests();
  const q = parseQuery(new URL(request.url), querySchema);
  if (!q.ok) return q.response;
  try {
    const feeds = await getHotspots(
      { env: serverEnv() },
      { days: q.data.days, country: q.data.country ?? null, confidence: q.data.confidence, includeUnassigned: q.data.unassigned === "true" },
    );
    return Response.json({ feeds }, { headers: { "cache-control": "public, s-maxage=300, stale-while-revalidate=900" } });
  } catch (error) {
    console.error("[api/hotspots]", error);
    return jsonError(500, "Hotspot data could not be assembled.");
  }
}
