import { z } from "zod";
import { allow, bearer, verifyKey } from "@/core/mcp/keys";
import { ingest } from "@/core/traffic/ingest";
import { getDb } from "@/db/client";

/**
 * POST /api/ingest/visits, from a site snippet (Cloudflare Worker, Next.js
 * or Express middleware), with "Authorization: Bearer ov_…" (a site key).
 * Body: { visits: [{ at, ua, ip, host, path, status, referer }] }, up to 500.
 * Only AI crawler visits and visits from AI assistants are kept.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const visit = z
  .object({
    at: z.union([z.string(), z.number()]).optional(),
    ua: z.string().max(1_000).nullish(),
    ip: z.string().max(64).nullish(),
    host: z.string().max(253).nullish(),
    path: z.string().max(2_000).nullish(),
    status: z.union([z.number(), z.string()]).nullish(),
    referer: z.string().max(2_000).nullish(),
  })
  // a visit says who made it: a user agent, or where it came from
  .refine((v) => !!(v.ua || v.referer), "Each visit needs ua or referer.");
const body = z.object({ visits: z.array(visit).min(1).max(500) });

/** A site can see a lot of bot traffic: a higher limit than the MCP server's. */
const LIMIT = 1_200;

export async function POST(request: Request) {
  const key = bearer(request.headers.get("authorization"));
  const db = getDb();
  const ctx = key ? await verifyKey(db, key) : null;
  if (!ctx || ctx.access !== "ingest")
    return Response.json(
      { error: "Use a site key from OpenVisibility → AI traffic." },
      { status: 401 },
    );
  if (!allow(ctx.keyId, Date.now(), LIMIT))
    return Response.json(
      { error: "Too many requests." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  let parsed;
  try {
    const json = await request.json();
    parsed = body.safeParse(
      Array.isArray(json) ? { visits: json } : "visits" in json ? json : { visits: [json] },
    );
  } catch {
    return Response.json({ error: "Send JSON." }, { status: 400 });
  }
  if (!parsed.success)
    return Response.json({ error: "Send { visits: [ … ] }, at most 500." }, { status: 400 });
  const r = await ingest(db, ctx.workspaceId, parsed.data.visits, "snippet");
  return Response.json(r);
}
