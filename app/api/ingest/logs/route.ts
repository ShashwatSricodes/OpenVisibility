import { getSession, getWorkspaceForUser } from "@/core/auth/session";
import { ingestLog, linesOf } from "@/core/traffic/ingest";
import { getDb } from "@/db/client";

/**
 * POST /api/ingest/logs: a server log uploaded from the AI traffic page
 * (Nginx or Apache "combined" format, or JSON lines from Cloudflare and
 * others), read a line at a time. Signed-in owners only.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 200 * 1024 * 1024;

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return Response.json({ error: "Sign in first." }, { status: 401 });
  const m = await getWorkspaceForUser(session.user.id);
  if (!m) return Response.json({ error: "No workspace." }, { status: 404 });
  if (m.role !== "owner")
    return Response.json({ error: "Only the workspace owner can upload logs." }, { status: 403 });
  const size = Number(request.headers.get("content-length") ?? 0);
  if (size > MAX_BYTES)
    return Response.json({ error: "Upload logs of up to 200 MB at a time." }, { status: 413 });
  if (!request.body) return Response.json({ error: "Attach a log file." }, { status: 400 });
  // gzipped logs are common: unpack them as they stream in
  const gz =
    /gzip/.test(request.headers.get("content-type") ?? "") ||
    request.headers.get("x-file-name")?.endsWith(".gz");
  const stream = gz ? request.body.pipeThrough(new DecompressionStream("gzip")) : request.body;
  const r = await ingestLog(getDb(), m.workspace.id, linesOf(stream));
  return Response.json(r);
}
