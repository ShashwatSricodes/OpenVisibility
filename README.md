# OpenVisibility

**The open-source alternative to Profound.** Track how ChatGPT, Gemini, Google AI Mode, Google AI Overviews, Perplexity and Claude talk about your brand: how often you're mentioned, where you rank, who you're compared with, and which sources the answers cite.

> **Status: early development.** The data layer works and is tested; scheduled runs work; the dashboard and billing are being built in the open. See [ROADMAP.md](ROADMAP.md) for the day-by-day plan.

## Why

AI visibility tools cost $99–$500+ a month, often billed yearly. OpenVisibility is built to be cheap to run:

- **Self-hosted, it can cost nothing.** Consumer-app answers come from [Bright Data](https://brightdata.com)'s free tier (5,000 answers a month), enough to track 15 prompts daily on three engines, asked three times each.
- **You see the cost before every run,** and set a monthly budget cap.
- **Mention rates, not anecdotes.** AI answers change between runs, so each prompt is asked several times and reported as a rate.

## What it tracks

| Engine | Source | Status |
| --- | --- | --- |
| ChatGPT | Consumer app, via Bright Data | ✅ Working |
| Gemini | Consumer app, via Bright Data | ✅ Working |
| Google AI Mode | Consumer app, via Bright Data | ✅ Working (US) |
| Google AI Overviews | Google results, via Bright Data | ✅ Working (US) |
| Perplexity | Consumer app, with the official API as fallback | 🚧 Fallback in progress |
| Claude | Official API (Vercel AI Gateway) | 🚧 In progress |
| Copilot | n/a | ⏸ Deferred: Copilot chat requires a login since August 2026 |

Details, measured results and pricing are in [docs/providers.md](docs/providers.md).

**What the numbers mean.** Consumer-app answers are what a logged-out visitor sees, which may differ from a paying subscriber's view. API answers measure how a model responds, not the app. Every result is labelled with its source.

## Quick start

Requires Node.js 22.

```bash
git clone https://github.com/ShashwatSricodes/OpenVisibility.git
cd OpenVisibility
npm install
cp .env.example .env.local     # add your Bright Data API key
```

Try the data layer: run one prompt through ChatGPT, Gemini, AI Mode and AI Overviews (uses 4 of your free answers):

```bash
npm run try -- chatgpt,gemini,ai_mode,ai_overviews "best invoicing software for freelancers" --brand Zoho --country US
```

Run the web app (landing page at `/`, product at `/dashboard`):

```bash
npm run dev
```

Add your Bright Data key either in `.env.local` (used by every workspace on this server) or per workspace in **Settings**, where it is tested and stored encrypted. In production also set `ENCRYPTION_KEY` (see `.env.example`).

No database setup is needed in development: without `DATABASE_URL`, the app uses an embedded Postgres stored in `.data/`. Sign in at `/login`; with no `RESEND_API_KEY`, the sign-in link is printed in the terminal. To use your own Postgres instead, run `docker compose up -d` and set `DATABASE_URL` (see `.env.example`).

A Docker image with one-command setup is planned for the first release.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app in development mode |
| `npm run build` | Production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript checks |
| `npm test` | Unit tests (Vitest), no network calls; database tests run on embedded Postgres |
| `npm run worker` | The run worker as its own process (with `DATABASE_URL`; with the embedded database it runs inside `npm run dev`) |
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Add demo data |
| `npm run format` | Format with Prettier |
| `npm run try` | Ask one prompt on one or more engines and print the normalized answer; `--workspace "<name>" --dry-run` shows what a workspace's run would ask |
| `npm run spike` | Run a prompt through the official model APIs (needs `AI_GATEWAY_API_KEY`) |
| `npm run spot-check` | Print random stored answers next to the mentions found in them, for a manual accuracy check; `--fixtures` uses the saved real answers |
| `npm run reanalyze` | Find mentions and label citations again in stored answers (after detector fixes), then rebuild the metrics |
| `npm run models` | List search-capable models and prices on the Vercel AI Gateway |
| `npm run mcp` | The MCP server over stdio, for Claude Desktop and other local clients; relays to the running app (`OV_MCP_KEY`, `OV_MCP_URL`) |

With the embedded database, only one process can open it at a time: stop `npm run dev` before `db:seed`, `spot-check` or `reanalyze`. They refuse to start while it's running.

## Use it from Claude, ChatGPT or Cursor (MCP)

OpenVisibility is an MCP server: ask your assistant "How visible are we on Gemini this week, and who beats us?" and it answers from your own runs. Create a key in **Settings → API keys and MCP** (read only, or read and change), then:

- **Claude Code:** `claude mcp add --transport http openvisibility <your app URL>/api/mcp --header "Authorization: Bearer ov_…"`
- **Cursor and other clients that take a URL:** point them at `<your app URL>/api/mcp` with the header `Authorization: Bearer ov_…`.
- **Claude Desktop:** add a server with `command: "npx"`, `args: ["tsx", "/path/to/OpenVisibility/mcp/stdio.ts"]` and `env: { "OV_MCP_KEY": "ov_…", "OV_MCP_URL": "<your app URL>/api/mcp" }`. Settings shows these snippets with your key filled in.

There are 23 tools: visibility and trends, competitors, prompts, answers, citations, content gaps, recommendations, the site audit, outreach, content briefs, runs and usage; with a write key, also adding and pausing prompts, starting runs (with the free-tier check), auditing the site and finding outreach pages. Outreach emails can't be approved or sent over MCP: a person approves each one in the app. Resources give the prompt list, a 30-day report and any answer in full; prompts include a weekly review and "how to beat a competitor".

## Project layout

```
app/(marketing)/   landing page and blog
app/(app)/         the product (dashboard)
core/              open-source engine: providers, analysis, runs
core/providers/    provider interface, engine registry, Bright Data adapter
docs/              provider research and measured results
scripts/           spikes and fixtures
```

## License

[AGPL-3.0](LICENSE). You can use, modify and self-host OpenVisibility freely. If you run a modified version as a service for others, you must publish your changes.

Hosted-only features (billing, wallet, managed keys, multi-tenancy) will live in an `ee/` folder under a separate commercial license.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
