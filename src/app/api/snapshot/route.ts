import { connection } from "next/server";
import { clientKey, jsonError, serverEnv, takeToken, tooManyRequests } from "@/lib/api/guard";
import { getSnapshot } from "@/lib/pipeline/service";

/**
 * GET /api/snapshot
 * Latest reading per series from every connected live provider, plus provider status and warnings.
 * Upstream calls are cached per provider (see each adapter's cacheTtlSeconds).
 */
export async function GET(request: Request) {
  await connection();
  if (!takeToken(`snapshot:${clientKey(request.headers)}`, 60, 60)) return tooManyRequests();
  try {
    const snapshot = await getSnapshot({ env: serverEnv() });
    return Response.json(snapshot, {
      headers: { "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=240" },
    });
  } catch (error) {
    console.error("[api/snapshot]", error);
    return jsonError(500, "The live snapshot could not be assembled. No readings are shown rather than guessed ones.");
  }
}
