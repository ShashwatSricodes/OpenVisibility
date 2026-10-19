# OpenVisibility: Build Roadmap

A day-by-day plan for turning the product plan into a working, launchable product. Each step is sized for one focused working day (roughly 2–4 hours). Do one step a day, tick it off, and commit.

**Where we are today:** the marketing landing page is built (Next.js 15, App Router, TypeScript) and pushed to `main`. Nothing else exists yet: no database, auth, tracking engine, or dashboard.

**Where we're going:** an open-source tracker (AGPL) that self-hosters run with their own keys, plus a hosted version with a prepaid wallet. Both run the same core code.

---

## How to use this file

- **One step per day.** If a step runs long, finish it the next day rather than starting two at once. Buffer days are built in.
- **Tick the boxes** (`- [x]`) as you go, so this file doubles as your progress tracker.
- **One branch per step:** `git checkout -b day-07-claude-gemini`. Merge to `main` when the "Done when" line is true.
- **Every step ends with:** typecheck passing, the app still building, and a commit.
- **If a step reveals a problem with the plan,** add it to the [Decision log](#decision-log) at the bottom, don't silently change course.

### Recommended stack

These choices keep the self-hosted version to a single Postgres and two Node processes, which matters for "one-command setup" and cheap VPS hosting.

| Concern | Choice | Why |
| --- | --- | --- |
| Web app | Next.js 15 (already in repo) | Landing page and dashboard in one app |
| Database | Postgres 16 + Drizzle ORM | Typed schema, plain SQL migrations, easy self-hosting |
| Job queue | pg-boss | Queue lives in Postgres, so there's no Redis to run |
| Worker | Separate Node process (`worker/`) sharing `core/` code | Long runs never block web requests |
| LLM calls | Vercel AI SDK + Vercel AI Gateway | One key, and each response reports its exact cost |
| Auth | Better Auth (email magic link) | Self-hostable, no third-party auth bill |
| Validation | Zod | Shared by env config, API input and LLM structured output |
| Email | Resend (hosted) / SMTP (self-host) | Magic links and low-balance alerts |
| Payments | Stripe (global), Razorpay (India) | Per the product plan |
| Tests | Vitest | Fast unit tests with recorded API fixtures |

### Target folder layout

```
app/
  (marketing)/        landing page, blog (moved here on Day 2)
  (app)/              authenticated dashboard
  api/                route handlers, webhooks
core/                 open-source engine, shared by web and worker
  providers/          provider abstraction + adapters
  analysis/           mention detection, parsing, citations, metrics
  runs/               estimate, fan-out, execution
db/                   Drizzle schema + migrations
worker/               pg-boss worker entry point
ee/                   hosted-only code (billing, wallet, managed keys), commercial license
docs/                 self-hosting and provider docs
```

### Accounts you'll need (set up as you reach them)

- [ ] Vercel account with AI Gateway enabled, plus a few dollars of credit (Day 1)
- [ ] Perplexity API key, as a fallback if Sonar isn't on the Gateway (Day 1)
- [ ] OpenRouter account, for BYOK testing (after launch, with the official-API route)
- [ ] Resend account (Day 5)
- [ ] Stripe account, test mode (Day 40)
- [ ] Razorpay account, test mode (Day 41)
- [ ] VPS (e.g. Hetzner) and managed Postgres (e.g. Neon) (Day 45)
- [ ] Sentry (free tier) (Day 45)

---

## Phase 0: Foundations (Days 1–5)

### Day 1: Verify the provider assumptions

The whole plan rests on what the Gateway actually supports. Check it before writing any product code.

- [x] Confirm the model list for each engine: OpenAI, Anthropic, Google, xAI and Perplexity. (`npm run models`; xAI is listed as `spacexai/`)
- [x] **Check whether Perplexity Sonar models are listed.** Only `perplexity/sonar` is, so the Accurate preset goes through Perplexity's own API.
- [x] Write a throwaway script (`scripts/spike.ts`) that sends one prompt to each engine with web search on and prints the answer text, the citations, token usage and `providerMetadata.gateway.cost`.
- [x] Add a Bright Data path to the spike (`npm run spike:bd`), built on the real client in `core/providers/brightdata.ts`.
- [x] Create a free Bright Data account, add `BRIGHT_DATA_API_KEY` to `.env.local`, and run `npm run spike:bd`. ChatGPT, Gemini, Google AI Mode and Google AI Overviews work (see `docs/providers.md`).
- [x] Copilot: researched and deferred. Copilot chat requires a login since 31 August 2026; options are recorded in `docs/providers.md`.
- [x] Write `docs/providers.md`: data sources, search pricing, model IDs, citation formats, location support, and measured Bright Data results.
- [ ] **Carried forward:** get a Gateway key and run `npm run spike -- --engine claude,perplexity` for Claude and the Perplexity fallback, and record their per-call costs. Deferred with the official-API route (decision log, 19 October 2026).

**Done when:** you have real answers with citations and a real cost from every engine, written down. (Done for the Bright Data engines on 18 October 2026; Claude and Perplexity carried forward.)
**Watch for:** citation formats differ a lot between providers. Save raw responses to `scripts/fixtures/` now, because they become your test fixtures on Day 10.

### Day 2: Restructure the repo

- [x] Move the landing page into `app/(marketing)/` (its own `layout.tsx` and `globals.css`) and create an empty `app/(app)/` group with its own root layout.
- [x] Add ESLint and Prettier, plus `typecheck`, `lint` and `test` scripts in `package.json`. (Vitest, with the first tests on the Day 1 fixtures.)
- [x] Add `core/env.ts`: load and validate environment variables with Zod, and fail fast on missing ones.
- [x] Add `.env.example` listing every variable, with comments.
- [x] Add `LICENSE` (AGPL-3.0), a short `README.md`, and `CONTRIBUTING.md` mentioning the CLA.
- [x] Delete leftovers from the template: `reference/standalone.html` and any unused images in `public/tpl/`.

**Done when:** `/` still renders the landing page, `/dashboard` renders a placeholder, and lint, typecheck and build all pass.

### Day 3: Database and the setup schema

- [x] Add `docker-compose.yml` with only Postgres for now.
- [x] Install Drizzle and `drizzle-kit`, and configure migrations in `db/migrations/`.
- [x] Create the setup tables:
  - `workspaces`: id, name, mode (`self_hosted` / `hosted`), default_countries[], created_at
  - `brands`: workspace_id, name, description, domains[]
  - `brand_aliases`: brand_id, alias
  - `competitors`: **brand_id**, name, aliases[], domains[] (per brand, so an agency workspace can track several clients)
  - `prompts`: **brand_id**, text, tags[], countries[], active
- [x] Generate the first migration (`db/migrations/0000_setup_tables.sql`).
- [x] Verified against Postgres (PGlite, in `db/db.test.ts`): migrations create every table. Run `docker compose up -d && npm run db:migrate` the first time you want a persistent local database.

**Done when:** `docker compose up -d && npm run db:migrate` creates the tables from scratch.

### Day 4: Tracking and results schema

- [x] `runs`: workspace_id, brand_id, trigger, status, estimated_cost, actual_cost, total_items, done_items, started_at, finished_at
- [x] `run_items`: one row per prompt × engine × country × sample, plus `source` (consumer app or official API), `external_id` (the Bright Data job) and a copy of the prompt text so history survives edits
- [x] `answers`: text, raw (minus bulky HTML), model, web_search_triggered, shown (AI Overviews), tokens, cost_usd
- [x] `mentions`: answer_id, competitor_id (null = the tracked brand), position, sentiment, snippet
- [x] `citations`: answer_id, url, domain, title, position, kind (`owned` / `competitor` / `third_party`)
- [x] Indexes on (workspace_id, created_at), (brand_id, created_at), (run_id), status and domain; cascade deletes.
- [x] Write `db/seed.ts` (`npm run db:seed`): demo workspace, Ledgerly, 5 competitors, 10 prompts. Safe to re-run.
- [x] Verified in `db/db.test.ts`: the seed is idempotent, costs keep six decimal places, deleting a prompt keeps its history, deleting a brand cascades.

**Done when:** the seed runs cleanly and you can query everything in Drizzle Studio.
**Note:** store cost as `numeric(12,6)`, never as a float.

### Day 5: Authentication and workspaces

- [x] Install Better Auth with email magic links (sent through Resend when `RESEND_API_KEY` is set; printed to the terminal otherwise).
- [x] On first sign-in, create a workspace and make the user its owner (a `memberships` table with user_id, workspace_id, role).
- [x] Protect the product pages: middleware redirects without a session cookie, and the `(workspace)` layout validates the session on the server.
- [x] Add server helpers (`requireUser`, `requireWorkspace`, `getWorkspaceForUser`) that every query goes through.
- [x] Embedded Postgres (PGlite) in development when `DATABASE_URL` is unset, migrated at startup, so the app runs with no setup.
- [x] Tests run the full flow on PGlite: request a link, open it, get a session and an owned workspace; reused links are refused.

**Done when:** you can sign in, land on the dashboard, and sign out. (Verified on 19 October 2026 against the running app.)

---

## Phase 1: Provider abstraction (Days 6–10)

This is the key piece of the architecture: the worker, the analysis and the dashboard reach AI engines only through one interface, so a new data source is one new adapter.

**Re-planned on 19 October 2026: Bright Data is the only data source for now.** It covers ChatGPT, Gemini, Google AI Mode and Google AI Overviews (Perplexity works only sometimes). Claude, Grok and Copilot wait for the official-API route, which moves after launch (see the decision log).

### Day 6: The provider interface and the Bright Data adapter

- [x] Define the contract in `core/providers/types.ts`. Providers work as jobs (`submit`, `check`, `collect`) because Bright Data does, and the job ID goes on each run item so a restarted worker never pays twice for a batch.
- [x] Typed errors in `core/providers/errors.ts` (`auth`, `rate_limited`, `timeout`, `blocked`, `bad_input`, `unavailable`, `upstream`), each marked retryable or not.
- [x] Engine registry in `core/providers/registry.ts`: name, maker, data source, status (available, unreliable, unavailable), verified countries, typical time, and Bright Data pricing.
- [x] `BrightDataProvider`: one batch per engine, failed answers kept as results (and not billed), and records matched back to prompts by index, or by prompt and country where Google's scraper drops the index.
- [x] `getProvider(engine)` and `query()` in `core/providers/index.ts`, plus a `FakeProvider` for tests and development without spending answers.
- [x] `npm run try` replaces `npm run spike:bd`.

**Done when:** `npm run try -- chatgpt "best invoicing app"` prints normalized output. ✅ 19 October 2026: 142 s, 3,090 characters, 2 citations, $0.0015 at list price.

### Day 7: Bring your own Bright Data key

- [x] Add `provider_credentials` (workspace_id, provider, encrypted_key, last4, created_by, created_at, verified_at). Encrypted with AES-256-GCM (`core/crypto.ts`) using `ENCRYPTION_KEY`, bound to the workspace ID so a copied row won't decrypt elsewhere. Keys never reach the browser.
- [x] Settings page (`/settings`): paste a key (it's tested with a free call before it's saved), test the key in use, and remove it. Only the workspace owner can change it.
- [x] Resolve the key at call time (`resolveProviderKeys` in `core/credentials.ts`): the workspace's own key first, then `BRIGHT_DATA_API_KEY`. A key that can't be decrypted (changed `ENCRYPTION_KEY`) gives a clear message.

**Done when:** a workspace with its own key gets answers, and deleting the key stops them with a clear message. ✅ 19 October 2026: verified in the running app (bad key refused and not saved, real key saved and tested, full key absent from the page, removal falls back to the server key). With no key anywhere, `getProvider` says to add one in Settings.

### Day 8: Engines and countries per workspace

- [x] Store each workspace's chosen engines (new `workspaces.engines` column; default ChatGPT, Gemini, AI Mode, AI Overviews) and countries (default US). `getTrackingConfig` in `core/tracking-config.ts` reads them, dropping engines that lose their data source.
- [x] "What to track" on the Settings page: every engine from the registry with its status and note (Claude, Copilot and Grok shown but can't be picked), countries as chips (up to 10, from `core/countries.ts`), and the answers each prompt uses per run.
- [x] Warnings as you choose (`core/tracking-rules.ts`): countries not yet tested for an engine (AI Mode and AI Overviews: US only) and unreliable engines (Perplexity).
- [x] `npm run try -- --workspace "<name>" "<prompt>"` runs with a workspace's engines, countries and key; `--dry-run` prints the plan for free.

**Done when:** the demo workspace's engine and country choices drive what `npm run try` and the cost estimate use. ✅ 19 October 2026: choices saved in the running app (3 engines, US and India, with the AI Mode warning) and read back by `npm run try --workspace … --dry-run` (6 answers). The cost estimate is Day 9 and reads the same config.

### Day 9: Free-tier usage meter

- [x] Count this month's free-tier usage from Bright Data itself: the records each snapshot delivered (`listSnapshots`), summed across every scraper. More accurate than our own table, because the free tier belongs to the Bright Data account and includes answers asked outside OpenVisibility; error-only snapshots aren't counted. Cached for 5 minutes so page loads never strain the rate limit. The workspace's own share comes from the `answers` table.
- [x] Real usage in the sidebar meter (amber past 80%, red at 100%; "No Bright Data key" links to Settings) and a "Usage this month" section on the Settings page, with the reset date.
- [x] `estimateRun()` in `core/estimate.ts`: active prompts × engines × countries (a prompt's own countries win) × 3 samples, checked against what's left this month, for one run and for running daily until the reset, with the pay-as-you-go cost of anything past the free tier.
- [x] `npm run try` checks the free tier first and won't go past it without `--yes`.

**Done when:** the sidebar meter shows real usage and a run that would go past the free tier is flagged before it starts. ✅ 19 October 2026: meter shows 6 of 5,000 (matching our test calls); the test workspace's 3 prompts estimate 45 answers a run and 585 running daily. The "Run now" button gets the same check when runs exist (Day 17).

### Day 10: Resilience, live check and tests

- [x] Re-ran every engine through the provider layer (`npm run try … --save`) and refreshed the fixtures; results in `docs/providers.md` ("Measured again"). ChatGPT, Gemini and AI Overviews answered; AI Mode failed once and worked on a retry; Perplexity is still blocked. `--save` no longer replaces a good fixture with a failure.
- [x] `RateGuard` (`core/providers/rate-guard.ts`): one per Bright Data account per process. It spaces requests out and stops all calls after 10 rate-limit responses in 5 minutes, well before Bright Data's IP block at 25. `Retry-After: 0` is now honoured.
- [x] `queryWithRetries` (`core/providers/retry.ts`): retries only the failed answers with doubling pauses, gives up on an engine that refuses two whole batches running, and resumes a timed-out batch by its snapshot ID instead of paying again. The Day 15 worker builds on it.
- [x] Tests for every adapter path, run offline: real network calls now fail any test (`test/no-network.ts`). Fixture tests check behaviour, plus that each saved raw record still normalizes to its saved result.

**Done when:** `npm test` passes offline and every available engine has a fresh fixture. ✅ 19 October 2026: 78 tests pass with the network blocked; ChatGPT, Gemini, AI Mode and AI Overviews fixtures are from today (Perplexity's is today's refusal; Copilot's is the 18 October login wall).

---

## Phase 2: Setup flow (Days 11–14)

### Day 11: The app shell

- [ ] Sidebar with Overview, Prompts, Answers, Citations, Competitors, Runs, Billing (hosted only) and Settings.
- [ ] Top bar with workspace name, date-range picker, country filter, and a "Run now" button.
- [ ] Reuse the landing page's tokens (fonts, colors, spacing) so the product and site feel like one thing.
- [ ] Add empty states for every page.

**Done when:** you can click through every section, even though they're empty.

### Day 12: Onboarding, part 1 (brand and competitors)

- [ ] Wizard step 1: brand name, one-line description, owned domains and aliases (chips input).
- [ ] Wizard step 2: competitors, each with aliases and domains.
- [ ] Show the honest-framing notice here: *"We measure how AI models respond through their APIs. Results won't exactly match the consumer apps."*

**Done when:** a new workspace can save its brand and three competitors.

### Day 13: AI-suggested prompts and the prompt manager

- [ ] Use a Budget model to generate 15–20 prompts customers might ask (discovery, comparison, how-to, brand questions) from the brand description, returned as Zod-validated structured output.
- [ ] Let the user accept, edit or reject each suggestion.
- [ ] Build the Prompts page: create, edit, delete, tag, and activate or pause prompts.
- [ ] Log the cost of the suggestion call.

**Done when:** onboarding ends with at least 10 saved prompts.

### Day 14: Countries, engines and presets

- [ ] Choose countries per workspace (default) and override them per prompt.
- [ ] Toggle each engine on or off, and pick a preset (Accurate or Budget) per engine.
- [ ] Set samples per prompt (1–10, default 3).
- [ ] Wizard final step: a review screen. The live cost estimate gets wired in on Day 17.

**Done when:** a workspace's full tracking configuration is saved and editable in Settings.

---

## Phase 3: Tracking engine (Days 15–20)

### Day 15: Queue, worker and fan-out

- [ ] Install pg-boss and create `worker/index.ts` as its own process (`npm run worker`).
- [ ] `createRun(workspaceId)` expands the configuration into `run_items` (prompt × engine × country × sample) and enqueues one job per item.
- [ ] Add a minimal job handler that marks items as done, for testing the plumbing.

**Done when:** clicking "Run now" creates a run and the worker drains its items.

### Day 16: Executing run items

- [ ] The handler calls the provider, stores the answer with its raw response and cost, and updates the item's status.
- [ ] Per-provider concurrency limits (e.g. 4 at a time per engine) and exponential backoff on rate limits.
- [ ] Idempotency: a retried job must never store a second answer or charge twice.
- [ ] When every item finishes, mark the run `completed` or `partial` and total up `actual_cost`.

**Done when:** a full run on the seed data finishes, with every answer and cost in the database.

### Day 17: Cost estimate and budget caps

- [ ] `estimateRun(config)` in `core/runs/estimate.ts`: calls × cost per call (from the registry) + parsing cost. Use the same function in the UI and on the server.
- [ ] Add a confirm dialog before manual runs showing calls, estimated cost and the remaining budget.
- [ ] Add a monthly budget cap per workspace. Refuse to start a run that would exceed it, and abort a running one if real costs pass the cap.

**Done when:** a run that would break the cap is blocked with a clear message.

### Day 18: Scheduling

- [ ] Per-workspace schedule: daily or weekly, time of day and timezone.
- [ ] Use pg-boss's cron support to enqueue scheduled runs, and show "Next run" in the UI.
- [ ] Skip a scheduled run (and record why) if it would break the budget.

**Done when:** a schedule set to five minutes from now fires on its own.

### Day 19: Caching and smart sampling

These features are what make the product cheap to run, so build them early.

- [ ] Cache: reuse an identical (engine, model, prompt, country) answer that's under N hours old, configurable and off by default for scheduled runs.
- [ ] Smart sampling (optional per workspace): if the first two samples agree on whether you're mentioned, skip the rest. Record skipped samples so the mention rate stays honest.
- [ ] Show the savings in the run summary.

**Done when:** the same run costs measurably less with both options on, and the metrics still make sense.

### Day 20: Run history page

- [ ] Table of runs: date, trigger, status, items done/total, estimated vs actual cost.
- [ ] Run detail: cost breakdown by engine, failed items with their errors, and a retry-failed button.
- [ ] Live progress while a run is in flight (polling every few seconds is fine).

**Done when:** you can watch a run progress and then see exactly what it cost.

---

## Phase 4: Analysis (Days 21–26)

### Day 21: Deterministic mention detection

- [ ] Match brand and competitor names plus aliases in the answer text: case-insensitive, word-boundary aware and Unicode-safe.
- [ ] Extract position from numbered and bulleted lists, otherwise from order of first appearance.
- [ ] Store each match in `mentions` with a short surrounding snippet.

**Done when:** tests cover tricky cases: names that are common words, possessives, and brands inside URLs.

### Day 22: LLM-assisted parsing

- [ ] Send each answer to a cheap model with a Zod schema covering: brands mentioned, their order, sentiment per brand (−1 to 1), and whether the mention is a recommendation.
- [ ] Reconcile with Day 21's results: deterministic matching wins on whether a brand is mentioned, the model fills in sentiment and handles fuzzy cases.
- [ ] Store the parsing cost on the answer, so per-run costs include analysis.

**Done when:** every new answer gets mentions and sentiment automatically, after the main call.

### Day 23: Citation processing

- [ ] Normalize URLs (strip tracking parameters, lowercase hosts, remove `www.`) and extract the domain.
- [ ] Classify each citation as owned (matches brand domains), competitor (matches competitor domains) or third-party.
- [ ] Keep the citation title where the provider gave one.

**Done when:** you can list the most-cited domains for a run.

### Day 24: Metrics aggregation

- [ ] Define every metric precisely in `docs/metrics.md` first:
  - **Mention rate:** samples that mention the brand ÷ total samples
  - **Average position:** mean position across samples where the brand appears
  - **Share of voice:** brand mentions ÷ all tracked-brand mentions
  - **Owned citation share:** owned citations ÷ all citations
  - **Sentiment:** mean sentiment across mentions
- [ ] Build a daily rollup table (workspace × day × engine × country × prompt) that the worker refreshes after each run.
- [ ] Write query helpers for the dashboard that read from the rollup, not from raw answers.

**Done when:** the numbers from your helpers match a hand calculation on seed data.

### Day 25: Accuracy check

- [ ] Write a script that prints 20 random answers next to their detected mentions, for a manual check.
- [ ] Fix whatever it turns up, and add each fix as a test case.
- [ ] Re-run analysis over stored answers (`npm run reanalyze`), so parser fixes apply to history.

**Done when:** spot checks show no missed or phantom mentions.

### Day 26: Buffer day

Catch up on anything that slipped. If you're on track, write tests for the run pipeline end to end, with providers mocked.

---

## Phase 5: Dashboard (Days 27–33)

### Day 27: Overview page

- [ ] KPI tiles: mention rate, average position, share of voice, owned citation share and sentiment, each with the change from the previous period.
- [ ] Trend chart: mention rate over time, one line per engine.
- [ ] A "where you're missing" list: prompts with the lowest mention rate.

**Done when:** the overview tells you in five seconds whether things are improving.

### Day 28: Prompts page with results

- [ ] A table where each prompt shows its mention rate per engine (a small heatmap), average position and a trend sparkline.
- [ ] Prompt detail: results per engine and country, with links to the underlying answers.

### Day 29: Answer archive

- [ ] List of answers filterable by engine, prompt, country, run, and mentioned or not.
- [ ] Detail view: full answer text with brand and competitor mentions highlighted, citations tagged owned or third-party, and metadata (model, preset, sample number, country, cost).

**Done when:** you can find and read any answer from any run.

### Day 30: Citations page

- [ ] Top domains with their kind, citation count and the engines that cite them.
- [ ] Owned vs third-party split, per engine.
- [ ] Top cited URLs, and owned pages that never get cited.

### Day 31: Competitors page

- [ ] Share of voice over time: your brand against each competitor.
- [ ] Head-to-head per engine: mention rate and average position side by side.
- [ ] Sentiment comparison.

### Day 32: Filters and CSV export

- [ ] Keep the date range, engine and country filters in the URL, so views can be shared and bookmarked.
- [ ] CSV export for answers, mentions, citations and the metrics rollup. Stream it so large exports don't time out.

**Done when:** every page respects the filters, and exports open cleanly in Excel or Sheets.

### Day 33: Polish and honest framing

- [ ] Loading and error states on every page.
- [ ] Add the "API answers, not the consumer apps" note to the overview and to every export.
- [ ] Make the layout usable on a phone.

---

## Phase 6: Self-hosting and the open-source release (Days 34–37)

### Day 34: Docker

- [ ] A multi-stage `Dockerfile` with a standalone Next.js build, and the worker in the same image with a different command.
- [ ] `docker-compose.yml` with web, worker and Postgres. Run migrations on start.
- [ ] Test on a clean machine or VPS: clone, copy `.env.example`, add one key, `docker compose up -d`.

**Done when:** a fresh install reaches the onboarding screen with a single command.

### Day 35: Documentation

- [ ] README: what it is, a screenshot, a quickstart, and the honest framing.
- [ ] `docs/self-hosting.md`, `docs/providers.md` (finalize it), `docs/configuration.md` (every env var) and `docs/costs.md` (what a typical month costs).

### Day 36: CI and releases

- [ ] GitHub Actions: lint, typecheck, test and build on every pull request.
- [ ] Publish the Docker image to GitHub Container Registry on tagged releases.
- [ ] Add a CLA bot (e.g. CLA Assistant), issue and PR templates, and a changelog.
- [ ] Pick a release rhythm (e.g. every second Friday) and write it in `CONTRIBUTING.md`.

### Day 37: Open core boundary

- [ ] Create `ee/` with its own `LICENSE` (commercial) and a README explaining the split.
- [ ] Add a feature flag: hosted-only modules load only when `OV_MODE=hosted` and `ee/` is present.
- [ ] Check that the open-source build compiles and runs with `ee/` deleted entirely.

**Done when:** `rm -rf ee && npm run build` succeeds.

---

## Phase 7: Hosted billing (Days 38–44)

Everything in this phase lives in `ee/`.

### Day 38: Multi-tenancy hardening

- [ ] Audit every query for workspace scoping, and add tests that try to read another workspace's data.
- [ ] Add rate limits to auth, run triggers and exports.
- [ ] Add workspace invites and roles (owner, member) for teams.

### Day 39: Wallet ledger

- [ ] `ledger_entries`: workspace_id, type (`topup`, `usage`, `platform_fee`, `adjustment`), amount_usd, reference (run_id or payment ID), created_at. The balance is always the sum of entries, never a stored number you overwrite.
- [ ] Meter usage: for each answer, debit the Gateway-reported cost × (1 + margin). Confirm the margin from the 5–10% range (the landing page currently says 7%).
- [ ] Charge the $10 monthly platform fee as a ledger entry.

**Done when:** a test run produces matching debits, and the balance is correct to the cent.

### Day 40: Stripe

- [ ] Stripe Checkout for wallet top-ups ($10, $25, $50 or a custom amount).
- [ ] A subscription for the $10 platform fee.
- [ ] A webhook handler with signature verification and idempotency (the same event never credits twice).

**Done when:** a test-mode top-up shows up in the wallet within seconds.

### Day 41: Razorpay

- [ ] Razorpay orders in INR for Indian customers, including UPI.
- [ ] A webhook handler with signature verification.
- [ ] Currency handling: store the INR amount paid and the USD credited, using the rate at payment time.
- [ ] Choose the payment provider from the billing country.

### Day 42: Enforcement and alerts

- [ ] Before any run (and between batches during it), check the balance. At zero, pause tracking and record why.
- [ ] Low-balance email when the balance drops below a threshold the user sets.
- [ ] Email when a run is skipped because of the budget or balance.
- [ ] Resume automatically after a top-up.

**Done when:** draining the test wallet pauses tracking, and a top-up resumes it.

### Day 43: Billing UI

- [ ] Show the wallet balance prominently, with top-up buttons.
- [ ] This month's breakdown: platform fee, API usage at cost, margin and parsing.
- [ ] Usage by engine, and the ledger as a table with CSV download.
- [ ] Budget cap and low-balance threshold settings.

### Day 44: Managed keys

- [ ] In hosted mode, workspaces without their own key use the platform Gateway key.
- [ ] An optional zero-data-retention toggle, with its surcharge passed through.
- [ ] Abuse guards: limit runs per hour for new accounts, and require a first top-up before the first scheduled run.

---

## Phase 8: Launch (Days 45–50)

### Day 45: Production hosting

- [ ] Web on Vercel (or the VPS), the worker on a cheap VPS, and managed Postgres with daily backups.
- [ ] Sentry for errors, an uptime check on the site and the worker, and a heartbeat alert if no jobs have run in 24 hours.
- [ ] Remember that hosting is billed separately from Gateway usage. Put the monthly fixed cost in `docs/costs.md`.

### Day 46: Connect the landing page to the product

- [ ] Point "Start tracking" at real sign-up, and set up a waitlist for the Agency plan.
- [ ] Update the estimator constants in `components/Pricing.tsx` with the real per-call costs from Day 1 and the confirmed margin.
- [ ] Add terms of service and privacy pages.
- [ ] Replace the remaining stock images that have generic AI-chat mockups baked in with real product screenshots.

### Day 47: Security review

- [ ] Secrets only in env vars, never logged, and provider keys encrypted at rest.
- [ ] Webhook signatures verified, and auth required on every route under `(app)` and `api/`.
- [ ] Run `npm audit` and fix high-severity issues.
- [ ] Test restoring from a backup.

### Day 48: Private beta

- [ ] Invite 5–10 people from your target audience: small businesses, freelancers, agencies, and Indian brands.
- [ ] Watch at least two of them go through onboarding live, and write down every point of confusion.
- [ ] Turn the feedback into a prioritized fix list.

### Day 49: Public launch

- [ ] Tag `v0.1.0` and publish release notes.
- [ ] Post to Show HN, Product Hunt, relevant subreddits and Indian startup and marketing communities.
- [ ] Put the cost story first in every post: open source, bring your own keys, pay per call.

### Day 50: Retro and version 2 planning

- [ ] Write a short retro: what was slower than expected, and what costs surprised you.
- [ ] Plan version 2: Google AI Overviews through a SERP API (e.g. DataForSEO), GA4 and Search Console integration, white-label reports, alerts, and content recommendations.
- [ ] Re-check Gateway pricing and model IDs, which change often.

---

## Progress at a glance

| Phase | Days | Outcome |
| --- | --- | --- |
| 0. Foundations ✅ | 1–5 | Verified providers, database, auth |
| 1. Provider abstraction ✅ | 6–10 | Bright Data engines behind one interface, own keys, usage meter |
| 2. Setup flow | 11–14 | Onboarding, prompts, configuration |
| 3. Tracking engine | 15–20 | Queued, scheduled, budget-capped runs |
| 4. Analysis | 21–26 | Mentions, sentiment, citations, metrics |
| 5. Dashboard | 27–33 | Every version 1 insight, plus CSV export |
| 6. Open-source release | 34–37 | Docker, docs, CI, open core boundary |
| 7. Hosted billing | 38–44 | Wallet, Stripe, Razorpay, enforcement |
| 8. Launch | 45–50 | Production, beta, public release |

**Milestones worth celebrating:**
- **Day 16:** first real run end to end. You're tracking AI visibility.
- **Day 27:** the overview page shows real trends.
- **Day 37:** the open-source version is releasable.
- **Day 49:** public launch.

---

## Decision log

Record decisions here as you make them, with the date and the reason.

| Date | Decision | Status |
| --- | --- | --- |
| 2026-10-18 | License: AGPL-3.0, to stop cheap hosted clones; hosted-only code in `ee/` under a commercial license. MIT was considered (OpenSEO grew fast on it). | Decided |
| | Hosted margin: 7% (plan says 5–10%) | Placeholder on landing page |
| 2026-10-03 | Perplexity: Budget uses `perplexity/sonar` on the Gateway; Accurate uses Perplexity's own API (only Sonar is on the Gateway) | Decided; direct-API preset still to pick |
| 2026-10-03 | Data source for self-hosting: Bright Data's consumer-app scrapers for ChatGPT, Gemini and Perplexity (Grok, Copilot and AI Mode available too); Claude through the official API. The free 5,000 answers a month cover 15 prompts daily, asked 3×. This reverses the plan's "API only" rule, so get legal advice before launch. | Decided |
| 2026-10-18 | Copilot: deferred. Copilot chat requires a login since 31 August 2026. Options if revisited: SerpApi `bing_copilot` (Copilot Search on Bing, no login, 250 free a month) or Apify's Copilot scraper (test first; may rely on signed-in accounts). | Deferred |
| 2026-10-18 | Google AI Overviews and AI Mode move into version 1, through Bright Data's free scrapers (US for now). | Decided |
| 2026-10-19 | Phase 1 uses Bright Data only. Claude, Grok and Copilot (and the official-API route for all engines) move after launch; Bright Data has no Grok scraper and Claude and Copilot need sign-in. OpenRouter/Gateway BYOK is dropped from Phase 1. | Decided |
| | Data source for the hosted version: Bright Data Scale ($1.30 per 1,000) or DataForSEO ($1.20 per 1,000, also covers Claude and AI Overviews) | Decide before Day 38 |
| | Google AI Overviews: version 2 through a SERP API, or skip | Deferred (Bright Data's AI Mode scraper may cover part of it) |
| | Web hosting: Vercel or VPS | Decide on Day 45 |

## Risks to keep in view

- **Usage costs grow with customers.** Enforce budget caps and the wallet from the first hosted user (Days 17 and 42), never later.
- **Scraping breaks the AI companies' terms of service.** Bright Data does the scraping, but OpenVisibility depends on it. Keep the official API as a fallback for every engine and get legal advice before launch.
- **Scraped answers are logged-out answers,** and API answers differ from the apps too. Label every result with its source (consumer app or API) in the dashboard and exports (Days 12 and 33).
- **Competitors can cut prices.** The lasting advantage is the cheap architecture (Day 19) and the underserved audience, not the price alone.
- **Provider details change often.** Keep model IDs and costs in one registry file (Day 10) and re-check them before launch.
