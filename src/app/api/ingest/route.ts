import { connection } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { jsonError, serverEnv } from "@/lib/api/guard";
import { runIngestion } from "@/lib/pipeline/run-ingestion";

/**
 * POST or GET /api/ingest  (Authorization: Bearer <CRON_SECRET>)
 *
 * Fetches every connected live and hotspot source and, when Supabase is configured, upserts the
 * results. Intended for a scheduler (for example Vercel Cron, hourly). Refuses to run without a
 * configured secret, so it can never be triggered anonymously.
 */
function authorised(request: Request, secret: string | undefined): boolean {
  if (!secret || secret.length < 16) return false;
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(token);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request) {
  await connection();
  const env = serverEnv();
  if (!env.CRON_SECRET) return jsonError(503, "Ingestion is disabled: CRON_SECRET is not configured.");
  if (!authorised(request, env.CRON_SECRET)) return jsonError(401, "Unauthorised.");
  const summary = await runIngestion(env);
  return Response.json(summary, { headers: { "cache-control": "no-store" } });
}

export const GET = handle;
export const POST = handle;
