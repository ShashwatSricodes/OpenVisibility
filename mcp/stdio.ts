/**
 * `npm run mcp`: the OpenVisibility MCP server over stdio, for clients that
 * start a local command (Claude Desktop, Claude Code, Cursor).
 *
 * It relays to the HTTP endpoint rather than opening the database itself,
 * so it works next to a running app (the embedded development database
 * allows one process) and against a hosted OpenVisibility the same way.
 *
 *   OV_MCP_KEY=ov_…                      a key from Settings → API keys (required)
 *   OV_MCP_URL=http://localhost:3000/api/mcp   where the app runs (default)
 *
 * Only protocol messages go to stdout; anything else goes to stderr.
 */

import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const key = process.env.OV_MCP_KEY;
const url = process.env.OV_MCP_URL ?? "http://localhost:3000/api/mcp";
if (!key) {
  console.error("Set OV_MCP_KEY to a key from OpenVisibility → Settings → API keys.");
  process.exit(1);
}

const local = new StdioServerTransport();
const remote = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${key}` } },
});

local.onmessage = (message) => {
  remote.send(message).catch((err) => {
    console.error(`OpenVisibility MCP: couldn't reach ${url}: ${String(err)}`);
    // answer the request with an error, so the client isn't left waiting
    if ("id" in message && message.id !== undefined)
      void local.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32000, message: `Couldn't reach OpenVisibility at ${url}: ${String(err)}` },
      });
  });
};
remote.onmessage = (message) => void local.send(message);
remote.onerror = (err) => console.error(`OpenVisibility MCP: ${String(err)}`);
local.onclose = () => void remote.close().then(() => process.exit(0));

// no top-level await: the project compiles to CommonJS
void (async () => {
  await remote.start();
  await local.start();
  console.error(`OpenVisibility MCP relaying to ${url}`);
})();
