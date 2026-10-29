import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { allow, bearer, verifyKey } from "@/core/mcp/keys";
import { buildServer } from "@/core/mcp/server";
import { getDb } from "@/db/client";

/**
 * The MCP server over streamable HTTP: POST /api/mcp with
 * "Authorization: Bearer ov_…" (a key from Settings → API keys).
 * Stateless: every request gets its own server, bound to the key's
 * workspace, so it scales like any other route.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const unauthorized = (message: string) =>
  Response.json(
    { jsonrpc: "2.0", error: { code: -32001, message }, id: null },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="OpenVisibility"' } },
  );

async function handle(request: Request) {
  const key = bearer(request.headers.get("authorization"));
  if (!key)
    return unauthorized("Add an API key: Authorization: Bearer ov_… (Settings → API keys).");
  const db = getDb();
  const ctx = await verifyKey(db, key);
  if (!ctx) return unauthorized("That API key isn't valid, or it was revoked.");
  if (!allow(ctx.keyId))
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32029, message: "Too many requests; wait a minute." },
        id: null,
      },
      { status: 429, headers: { "Retry-After": "60" } },
    );

  const server = buildServer({
    db,
    workspaceId: ctx.workspaceId,
    access: ctx.access,
    appUrl: process.env.BETTER_AUTH_URL ?? new URL(request.url).origin,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    // stateless: nothing to keep between requests
    void server.close();
  }
}

export { handle as GET, handle as POST, handle as DELETE };
