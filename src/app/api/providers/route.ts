import { connection } from "next/server";
import { serverEnv } from "@/lib/api/guard";
import { recentLogs } from "@/lib/pipeline/ingest";
import { providerStatuses } from "@/lib/pipeline/service";

/** GET /api/providers: connection status, cadence, licence and recent ingestion logs per source. */
export async function GET() {
  await connection();
  const providers = providerStatuses(serverEnv());
  return Response.json(
    { providers, logs: recentLogs().slice(0, 50) },
    { headers: { "cache-control": "no-store" } },
  );
}
