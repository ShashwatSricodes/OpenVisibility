# OpenVisibility

**The open-source alternative to Profound.** Track how ChatGPT, Gemini, Google AI Mode, Google AI Overviews, Perplexity and Claude talk about your brand: how often you're mentioned, where you rank, who you're compared with, and which sources the answers cite.

> **Status: early development.** The data layer works and is tested; the dashboard, scheduling and billing are being built in the open. See [ROADMAP.md](ROADMAP.md) for the day-by-day plan.

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
| `npm run db:migrate` | Apply database migrations |
| `npm run db:seed` | Add demo data (stop the dev server first when using the embedded database) |
| `npm run format` | Format with Prettier |
| `npm run try` | Ask one prompt on one or more engines and print the normalized answer; `--workspace "<name>" --dry-run` shows what a workspace's run would ask |
| `npm run spike` | Run a prompt through the official model APIs (needs `AI_GATEWAY_API_KEY`) |
| `npm run models` | List search-capable models and prices on the Vercel AI Gateway |

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
