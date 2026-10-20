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

- [x] Sidebar with Overview, Prompts, Answers, Citations, Competitors, Runs, Settings, Help, and Billing for hosted workspaces only (self-hosted workspaces get a 404 there). The mobile menu now has Settings and Help too.
- [x] A shared page frame (`app/(app)/_components/page-frame.tsx`) for every page's title row, plus an empty-state component.
- [x] Prompts and Competitors list the workspace's real rows (read-only until Days 12–13); Answers, Citations and Runs explain what will appear after the first run, and Runs shows how many answers a run would use. Help links to the docs and explains how to read results.
- [x] The Overview page says plainly that its numbers are samples until the first run.
- [x] The date-range picker, country filter and Run now button stay on the Overview, where there's data to filter; other pages get filters on Day 32. The product already shares the landing page's fonts and tokens.

**Done when:** you can click through every section, even though they're empty. ✅ 19 October 2026: every page returns 200 signed in and redirects to /login signed out; checked on desktop and mobile.

### Day 12: Onboarding, part 1 (brand and competitors)

- [x] `/onboarding`, a full-screen wizard. New workspaces land there from the Overview until they have a brand; afterwards it's where the brand and competitors are edited (prefilled).
- [x] Step 1: brand name, one-line description, owned domains and other names, as chips. Pasted URLs are reduced to their domain; bad domains are explained.
- [x] Step 2: competitors, each with domains and other names. Saving matches competitors by name, so ones kept on the list keep their history; only removed ones are deleted (the wizard says so).
- [x] Rules in `core/brand-setup.ts` (shared by the form and the server), saving in `core/brands.ts`, owners only.
- [x] The honest-framing notice, updated for how answers are actually collected: *"We ask each engine your questions as a logged-out visitor, through Bright Data. Signed-in or paying users may see different answers…"*

**Done when:** a new workspace can save its brand and three competitors. ✅ 19 October 2026: a brand-new user was sent to setup, saved Ledgerly with 3 competitors by typing into the wizard, saw them on the Competitors page, and reached the Overview.

### Day 13: Prompt research and the prompt manager

- [x] Brands gain a category ("invoicing software") and an audience ("freelancers"), asked in step 1 of setup.
- [x] Suggestions (`core/prompt-suggest.ts`): 20 prompts, about two-thirds non-branded. Without a key they come from templates built on the category, audience and competitors; with `AI_GATEWAY_API_KEY` a cheap model (`PROMPT_SUGGEST_MODEL`, default `google/gemini-3.5-flash-lite`) writes them as Zod-validated structured output, falling back to templates if the call fails. The cost is logged when the gateway reports it.
- [x] Setup step 3: accept, untick, edit or add each suggestion; prompts already tracked aren't suggested again. "Get suggestions" on the Prompts page reopens this step.
- [x] Every prompt is tagged with its intent and, automatically, branded or non-branded (re-tagged after every edit). Otterly's funnel stage maps from the intent (`FUNNEL` in `core/prompt-rules.ts`).
- [x] Prompts page: add, edit inline, filter (all, non-branded, branded, paused), set countries per prompt, pause or resume, delete (past answers stay). Duplicates are refused; workspaces can't touch each other's prompts.

**Done when:** onboarding ends with at least 10 saved prompts. ✅ 19 October 2026: a new user saved 20 prompts from the suggestions (one unticked, one edited, one added), then edited, paused, deleted and filtered them on the Prompts page.

### Day 14: Samples and the setup review

- [x] Countries per workspace with per-prompt overrides (Day 8 and the Day 13 prompt manager); engines on or off per workspace (Day 8).
- [x] Samples: how many times each prompt is asked per engine and country, 1–10, default 3 (new `workspaces.samples`), in Settings. Every estimate now uses it.
- [x] Setup step 4, the review: brand, competitors, prompts (and how many are non-branded), engines, countries and samples, each with an Edit link; answers per run, and whether one run and daily runs until the reset fit in the free tier, with warnings. `/onboarding?step=review` opens it directly.
- [x] Dropped: Accurate/Budget presets per engine. They chose between paid model APIs, which Phase 1 set aside for Bright Data.

**Done when:** a workspace's full tracking configuration is saved and editable in Settings. ✅ 19 October 2026: a new user set up a brand, 3 competitors and 12 prompts and saw 144 answers a run (4 engines × 1 country × 3 asks × 12 prompts); asking 2× in Settings changed the review to 96.

---

## Phase 3: Tracking engine (Days 15–20)

### Day 15: Queue, worker and fan-out

- [x] No pg-boss (decision log): `run_items` is the queue. `core/runs/worker.ts` ticks through it: submit queued items as one batch per run and engine (job ID saved on each item), check and collect running batches (answers and labelled citations stored once per item), re-queue retryable failures up to 3 tries, give up on batches stuck for 45 minutes, and close runs as completed, partial or failed with their totals and a note saying why.
- [x] `createRun` (`core/runs/create.ts`) fans active prompts out into items: prompt × engine × country (a prompt's own countries win) × samples. One run at a time per workspace; a subset (some prompts, some engines) for small test runs.
- [x] The worker runs inside `npm run dev` with the embedded database, and as `npm run worker` with `DATABASE_URL` (`OV_WORKER` overrides). `OV_FAKE_ANSWERS=1` answers instantly, for trying runs for free.
- [x] Run now on the Overview and the Runs page; it asks before a run that would pass the free tier. The Runs page lists runs with progress and refreshes itself while one is in progress.

**Done when:** clicking "Run now" creates a run and the worker drains its items. ✅ 19 October 2026: Run now on the Overview created a 96-item run (fake answers); the worker submitted it in one tick and collected all 96 in the next, and the Runs page went from Running 0/96 to Completed 96/96 on its own.

### Day 16: Executing run items

- [x] The worker calls the provider, stores each answer with its raw record, cost, latency and labelled citations, and updates the item (built on Day 15).
- [x] Concurrency: one batch per run and engine, so a run is a handful of Bright Data jobs, not one per item; the account-wide rate guard (Day 10) spaces requests. Each batch is checked every 15 seconds, not every tick.
- [x] Backoff: a batch that fails to submit waits a minute; failed answers are re-queued up to 3 tries.
- [x] Idempotency: one answer per item (unique key), and a batch already paid for is resumed by its job ID, never resubmitted (tested).
- [x] Runs close as completed, partial or failed, with `actual_cost` totalled from the answers.
- [x] Test run: 3 prompts, one engine and country, asked once (about 3 answers), to check a key and setup cheaply.

**Done when:** a full run on the seed data finishes, with every answer and cost in the database. ✅ 20 October 2026: a real test run (3 ChatGPT answers, US) completed in 4 min 25 s; each answer stored with 3,000–4,000 characters, its raw record, $0.0015, and 2–3 citations labelled third-party; the run totalled $0.0045.

### Day 17: Cost estimate and budget caps

- [x] `estimateRun` (`core/estimate.ts`, Day 9) is shared by Settings, the setup review, the Runs page and the server; with Bright Data there's no parsing cost to add yet (that comes with model-assisted analysis, Day 22).
- [x] The confirm before Run now (Day 15) shows the answers and the cost past the free tier.
- [x] A monthly answer limit per workspace (`workspaces.monthly_answer_cap`, `core/budget.ts`), in answers because that's how Bright Data bills; default 5,000 (the free tier), editable or removable in Settings with the cost past the free tier shown. It counts answers billed this month plus answers sent and not back yet.
- [x] A run that won't fit is refused with a clear message (Run now, Test run, and scheduled runs, since all go through `createRun`). A run in progress sends only what fits before each batch, marks the rest skipped, and finishes partly done with a note.

**Done when:** a run that would break the cap is blocked with a clear message. ✅ 20 October 2026: with a limit of 50 and 3 answers already used, Run now on a 96-answer setup said "This needs 96 answers, but only 47 are left under your monthly limit of 50…" and started nothing.

### Day 18: Scheduling

- [x] Per-workspace schedule: off, daily or weekly (pick the day), a time of day and a timezone (`core/schedule-rules.ts`, Settings → Schedule). Local times hold across clock changes; no date library needed.
- [x] The worker loop starts due runs itself (`core/runs/schedule.ts`) instead of pg-boss cron, which we dropped on Day 16. Each due workspace is claimed by moving its next time forward first, so two workers never start the same run, and missed times after downtime collapse into one run. "Next run" shows in Settings and on the Runs page.
- [x] A scheduled run that won't start (over the monthly limit, the last run still going, no prompts) is recorded as a "Skipped" run with the reason. Settings warns when a schedule would use more than the monthly limit.

**Done when:** a schedule set to five minutes from now fires on its own. ✅ 20 October 2026: a daily schedule saved at 11:01 for 11:06 IST started a scheduled run at 11:06 with no one touching the app.

### Day 19: Caching and smart sampling

These features are what make the product cheap to run, so build them early.

- [x] Answer reuse (`core/runs/cache.ts`): a run copies this workspace's answers to the same (engine, country, prompt) that are under N hours old (1–168, Settings), with their citations, at no cost; each sample takes a different earlier answer. Only answers that were really asked are reused, never copies, so nothing outlives its age limit. The model isn't part of the match because Bright Data doesn't let us pick it. Off by default; when on, scheduled runs still ask fresh unless "Scheduled runs too" is ticked, and test runs always ask fresh. Reused answers don't count against the monthly limit.
- [x] Smart sampling (per workspace, needs 3+ samples): the worker asks samples 1 and 2 first and holds the rest. If both name the brand or neither does, the rest are skipped with `skip_reason = sampling` and `inferred_mentioned` set to the agreed result, so mention rates (Day 24) can count them; if they disagree or one failed, the rest are asked. Skipped samples don't make a run "partly done". It uses a simple brand-name check (`core/brand-mention.ts`) until mention detection lands on Day 21.
- [x] The Runs page shows "N reused · N not needed" and "saved $X" per run, and leaves skipped samples out of the progress total.

**Done when:** the same run costs measurably less with both options on, and the metrics still make sense. ✅ 20 October 2026 (fake answers): with 3 samples, smart sampling asked 96 of 144 answers (48 not needed, saved $0.072); with reuse on as well, the same run asked none (144 reused, est. $0.0000, saved $0.216). Tests check that each skipped sample carries the agreed mention result. Note for Day 24: count `inferred_mentioned` samples in mention rates.

### Day 20: Run history page

Kept simple on purpose: users see what they can act on, not the plumbing.

- [x] Table of runs: when, trigger, status, answers, time taken, cost and savings. Each row opens the run. The estimate shows only while a run is going; notes show only when there's something to do (limit reached, key refused, skipped), not passing hiccups the worker retries on its own.
- [x] Run page (`/runs/[id]`, `core/run-detail.ts`): status, answers, time, cost, savings, answers and cost per engine, and the answers themselves grouped by prompt (collapsed), with their sources.
- [x] Live progress: both pages refresh every few seconds while a run is going, with progress bars only then.
- Decided against: listing failed items with their errors and a retry-failed button. The worker already re-asks failed answers up to 3 times; a run that still ends short says why in one line.

**Done when:** you can watch a run progress and then see exactly what it cost. ✅ 20 October 2026.

---

## Phase 4: Analysis (Days 21–26)

### Day 21: Deterministic mention detection

- [x] Match brand and competitor names, aliases and domains in the answer text (`core/mentions.ts`): case-insensitive, whole-word and Unicode-safe. A single plain-word name ("Wave", "Square") must be capitalised, so common words don't count; scripts without capitals are exempt. In URLs only the host counts. The longest name wins when names overlap.
- [x] Position from numbered and bulleted lists (including "### 1." headings), then order of first appearance for brands named outside the list. Only tracked brands are ranked.
- [x] Each match is stored in `mentions` (one per brand per answer) with the sentence around it. A worker step analyzes any answer not analyzed yet (`answers.analyzed_at`, `core/analysis.ts`), so new answers, reused copies and older answers are all covered, and editing the brand's names or competitors re-checks past answers. Smart sampling now uses the same detector.
- [x] The run page shows the tracked brands each answer names, in order, with yours highlighted, or "Doesn't name you".

**Done when:** tests cover tricky cases: names that are common words, possessives, and brands inside URLs. ✅ 20 October 2026: 15 detector tests (also aliases, overlaps, Unicode, symbols, lists, headings, snippets) plus storage and re-analysis tests; the 579 answers already in the dev database were analyzed on startup.

### Day 22: LLM-assisted parsing

Built and tested; **switched off until a model key is chosen** (20 October 2026: decided to come back to the provider later).

- [x] Any OpenAI-compatible model (`core/sentiment.ts`), set with `ANALYSIS_BASE_URL`, `ANALYSIS_MODEL` and `ANALYSIS_API_KEY` (optional for a local Ollama), so free tiers work: Groq, Gemini, OpenRouter `:free`, Cerebras, plus DeepSeek (cheap) and Ollama (local). `.env.example` lists the addresses. Without them the step is off and answers keep their mentions without ratings.
- [x] A Zod schema per answer: for each tracked brand the answer names, sentiment (−1 to 1) and whether it's a recommendation. Several answers per call (`ANALYSIS_BATCH`, default 5), one call per worker tick, so free tiers' request limits aren't reached. Answers that name no tracked brand are skipped without a call.
- [x] Reconciled with Day 21: deterministic matching decides whether a brand is mentioned; the model only rates those mentions. Brands the model names that the detector didn't find are ignored for now (fuzzy matching can come later).
- [x] The analysis cost is stored on the answer (`analysis_cost_usd`, from token usage and `ANALYSIS_PRICE_*`) and counted in the run's cost, even when rating finishes after the run. A failing model is retried 3 times, then the answer is left unrated. Renaming the brand or competitors re-rates.
- [ ] Live check with a real key.

**Done when:** every new answer gets mentions and sentiment automatically, after the main call. ✅ in tests with a mock model; live check pending a key.

### Day 23: Citation processing

- [x] Normalize URLs (`core/citations.ts`): strip click-tracking parameters (`utm_*`, `gclid`, `fbclid`, `srsltid`…) but keep ones that may change the page (`ref`, `tab`…), drop Google's `#:~:text=` highlights and other fragments, lowercase hosts, remove `www.` and default ports, and store each page once per answer.
- [x] Classify each citation as owned, competitor (and which one: `citations.competitor_id`) or third-party, subdomains included. The analysis step re-labels past citations when the brand's or competitors' domains change; existing citations were cleaned up once by the migration.
- [x] Keep the citation title where the provider gave one.
- [x] The Citations page (last 30 days): how often answers cite your site, a competitor's or any source, then the most-cited domains, each opening to its most-cited pages. The run page has the same list for that run.

**Done when:** you can list the most-cited domains for a run. ✅ 20 October 2026: on the run page and in `citationSummary` (tested, including that another workspace sees nothing).

### Day 24: Metrics aggregation

- [x] Every metric defined in [`docs/metrics.md`](docs/metrics.md), with a worked example: mention rate (smart-sampling samples count with their inferred result, for your brand only), average position, share of voice, citation share (owned citation share for your brand), sentiment, Net Sentiment Score (positive ≥ 0.25, negative ≤ −0.25), coverage, and Brand Visibility Index = 100 × (0.5 × mention rate + 0.25 × mean 1/position + 0.25 × share of voice). All are computed for your brand and each competitor alike (`core/metrics.ts`).
- [x] Daily rollup `metrics_daily` (workspace × day × engine × country × prompt × tracked brand) of counters, not ratios, so any selection is a sum (`core/rollup.ts`). The worker rebuilds a day when one of its runs finishes, and again after its answers are re-analyzed or rated; runs still going and answers awaiting mention detection aren't counted.
- [x] Query helpers that read only the rollup (`core/metrics-query.ts`): `brandMetrics` (your brand first, then competitors by visibility index, with coverage) and `metricsBy` day, engine, country or prompt, filterable by dates, engines, countries and prompts.

**Done when:** the numbers from your helpers match a hand calculation on seed data. ✅ 20 October 2026: the worked example and a 12-sample run match by hand (`core/metrics.test.ts`, `core/runs/runs.test.ts`); existing dev runs were rolled up on startup.

### Day 25: Accuracy check

- [x] `npm run spot-check` prints random stored answers (each text once) with detected mentions marked «like this», the ranked brands with their sentences, every other place a tracked name appears ("not counted"), and where stored mentions differ from what the detector finds now. `--fixtures` runs the saved real answers in `scripts/fixtures`.
- [x] Found and fixed: Bright Data returns answers without line breaks, so lists are inline ("… 1. Zoho Invoice … 2. FreshBooks …") and positions fell back to order of first appearance. Lists are now also found inline (numbers counting up from 1), and a brand ranks by the list item it *opens* (first 80 characters), so a passing "Stripe or PayPal" inside an item doesn't take that rank. Tests: inline lists, passing mentions, a later numbered list of questions, and the four real fixture answers with hand-checked rankings.
- [x] `npm run reanalyze` re-detects mentions and re-labels citations in stored answers, then rebuilds the metrics.
- [x] Safety: the embedded database now has a lock file, so a script (or a second dev server) refuses to open it while `npm run dev` has it, instead of risking the damage it suffered once during development (19 October).
- Noted, not changed: an answer to "alternatives to Wave" names Wave as its subject, which counts as a mention ranked first. That's how tracking tools generally count it; the sentiment model (Day 22) and recommendation flag will separate "named" from "recommended".

**Done when:** spot checks show no missed or phantom mentions. ✅ 20 October 2026: the four real fixture answers (ChatGPT, Gemini, AI Mode, AI Overviews) and 40 stored answers, including the three real ChatGPT answers, show no misses or phantoms; all 579 stored answers were re-analyzed.

### Day 26: Buffer day

Catch up on anything that slipped. If you're on track, write tests for the run pipeline end to end, with providers mocked.

---

## Phase 5: Dashboard (Days 27–33)

### Day 27: Overview page

- [x] KPI tabs: mention rate, average position, share of voice, owned citation share and sentiment (shown once an analysis model rates answers), each with the change from the previous period of the same length, green when it's good news (lower is better for position).
- [x] Trend chart: the selected KPI over time, one line per engine. A young workspace's chart starts at its first results (at least a week shown).
- [x] "Where you're missing": prompts by lowest mention rate, with a "Winning" tab; plus competitors' share of voice and mention rate, engines by mention rate and position, and cited sources (domains, pages, yours).
- [x] Annotations (Otterly parity): add a note to a day ("published comparison page"); it shows as a marker on the chart, in the tooltip, and in a list under it (`annotations` table).
- [x] Filters for date range (7, 30, 90 days), engine and country, kept in the URL so a view can be shared; the page reads only the daily metrics (`core/overview.ts`). The made-up sample data is gone: a workspace without results sees an empty state pointing to Runs.

**Done when:** the overview tells you in five seconds whether things are improving. ✅ 20 October 2026: a line at the top says it in words ("Improving: Ledgerly is named in 50% of answers, up 8 pts on the 30 days before"), coloured green or red, with the visibility index.

### Day 28: Prompts page with results

- [x] The Prompts page opens on **Results** (the editor moved to **Manage prompts**): each prompt's mention rate overall and per engine as a small heatmap, average position and a trend sparkline, worst first, over 7, 30 or 90 days (`core/prompt-results.ts`, `metricsBy2` for prompt × engine and prompt × day). Paused prompts and prompts without results are marked, not hidden.
- [x] Prompt page (`/prompts/[id]`): named in, position, share of voice and visibility index; who wins the prompt (your brand against each competitor); results per engine and country; the latest 20 answers with the brands each names, an excerpt of what it says about you, and a link that opens that exact answer on its run page.

**Done when:** (not set in the plan) ✅ 20 October 2026: browser-checked from the table to a prompt to the highlighted answer on its run page; tested against hand-built results.

### Day 29: Answer archive

- [x] `/answers`: every stored answer, newest first, filterable by engine, prompt, country, run and whether it names you, with a text search over answers and prompts; paginated. The filters are a plain form, so any filtered view has its own link (`core/answer-archive.ts`).
- [x] `/answers/[id]`: the full text with every place a tracked brand is named highlighted (yours green, competitors amber; `findMatches` in `core/mentions.ts`), the brands named in rank order with the sentence around each (and sentiment and "recommended" once rated), sources tagged yours, competitor (by name) or third party, and details: engine, source (the real app via Bright Data, or an official API), model, country, sample, whether it searched, cost, time taken. Linked from the run page, the prompt page and the list.
- [x] **Query fan-out** (Otterly parity): ChatGPT's searches from Bright Data's `web_search_query`. When Bright Data says "no search" but the answer cites sources, the page says the searches weren't reported rather than claiming none.
- [x] Fixed: citations without a provider position were listed in random order; they now keep the order they were cited in.
- ⏸ ChatGPT ads and shopping cards, Google AI Overviews ads: deferred (decision log, 20 October 2026). The raw answers keep Bright Data's `ads` and `shopping` fields, so this can be added later without re-asking.

**Done when:** you can find and read any answer from any run. ✅ 20 October 2026: all 579 stored answers are listed; filters, search and opening a real ChatGPT answer checked in the browser.

### Day 30: Citations page

Built on Day 23's page and queries (`core/citation-stats.ts`), filterable by 7, 30 or 90 days and by engine.

- [x] (Otterly parity) Each cited page's place in the answer's list of sources over time (1 = cited first), as a sparkline next to its average place, for the most-cited pages.
- [x] Top domains with their kind (yours, the competitor by name, third party), how many answers cite them and the engines that cite them.
- [x] Whose sites each engine cites: the share of each engine's answers citing yours, a competitor's or a third party's site.
- [x] Top cited pages, and your pages: every page of yours an engine has cited, flagged when it hasn't been cited in the selected period. Pages never cited at all need your sitemap, which comes with the GEO audit (Days P2–P3).

**Done when:** (not set in the plan) ✅ 20 October 2026: checked in the browser with the engine and range filters; tested against hand-built citations (split per engine, engines per domain, a page's place per day, a page of yours dropping out).

### Day 31: Competitors page

- [x] Leaderboard: you and each competitor by visibility index, with mention rate, position, share of voice (and its change from the previous period) and own-site citation share (`core/competitor-results.ts`).
- [x] Share of voice over time: one line per brand, yours drawn heavier.
- [x] Head-to-head per engine: mention rate and average position side by side, the leader in bold.
- [x] Where they beat you: prompts where a competitor is named more often than you, biggest gap first, linking to the prompt.
- [x] Sentiment comparison: average sentiment and Net Sentiment Score per brand once an analysis model rates answers; until then a line explaining how to turn it on.
- [x] Filters for 7, 30 or 90 days and per engine, like the other pages.

**Done when:** (not set in the plan) ✅ 20 October 2026: checked in the browser; tested against hand-built answers (leaderboard, share of voice per day, head-to-head, prompts lost).

### Day 32: Filters and CSV export

- [x] Date range, engine and country live in the URL (`core/filters.ts`) on the Overview, Prompts, Citations and Competitors, with the same Filter and date menus on each. Prompts, Citations and Competitors gained the country filter; the Answers page gained a date range ("Any time" by default, since it's where you look for an old answer). The Overview's sources card now follows the filters too.
- [x] CSV export of answers, mentions, citations and the daily metrics (`core/exports.ts`, `GET /api/export/<kind>.csv`), filtered like the page it's downloaded from. Rows are read 500 at a time (answers by a timestamp-and-id cursor) and streamed, so a large export never sits in memory. Files have a UTF-8 BOM, CRLF line ends and quoted text; text that starts like a formula gets an apostrophe so a spreadsheet won't run it. Exports read stored answers only, so they cost nothing.
- [x] Report (`/report`): the Overview's KPIs and trend, the competitor leaderboard and the prompts they win, where you're missing, and the sources cited, on one page with the same filters. It prints light whatever the theme, and the browser's "Save as PDF" makes the file; no server-side PDF engine to install.

**Done when:** every page respects the filters, and exports open cleanly in Excel or Sheets. ✅ 20 October 2026: each page kept its filters in the URL and picking Gemini from the menu updated the link; all four CSVs downloaded from the dev data (579 answers, 1,785 mentions, 584 citations, 384 metric rows), each with a BOM and the same number of columns on every row; the report printed to a 2-page PDF. Signed-out downloads get a 401.

### Day 33: Polish and honest framing

- [x] Loading and error states on every page: a skeleton in the page's shape while data loads (streamed before the page), a "This page didn't load" page with Try again, and a Not found page for deleted answers, prompts and runs, all inside the app's layout. Setup and the report get the same error page. No error details on screen; they go to the logs.
- [x] The honest-framing note, reworded for how answers are now collected (the consumer apps as a logged-out visitor, Claude through its API; `core/framing.ts`): at the foot of the Overview, under every Export menu and at the end of the report. The CSV files stay plain (header row first) so they load straight into a spreadsheet or database.
- [x] Usable on a phone: checked every page at 390px wide; nothing spills sideways (wide tables scroll inside their box). Page descriptions wrap instead of being cut off, the filter menus fit on one row (Export shows its icon only), and the Prompts table keeps its prompt column readable.

**Done when:** ✅ 20 October 2026: a page made to fail showed the error page with the sidebar still there; a missing answer showed Not found; the skeleton was streamed ahead of each page; all pages passed the 390px check with a clean console.

---

## Phase 5b: Parity with Otterly (Days P1–P9)

Otterly.ai is the closest affordable competitor ($29–$489 a month; checked 19 October 2026). Its core features, mapped onto this plan, are in the [parity table](#otterly-parity) below. These days cover what the plan was missing.

### Day P1: Alerts ⏸

Deferred with teams, integrations and access (decision log, 20 October 2026).

### Day P2: GEO audit, part 1 (can AI crawlers read your pages?)

- [ ] For a URL: robots.txt rules for GPTBot, OAI-SearchBot, ChatGPT-User, Google-Extended, PerplexityBot, ClaudeBot and others; meta robots and X-Robots-Tag; HTTP status, redirects and load time; whether the main text is in the HTML without JavaScript; `llms.txt`.
- [ ] Audit every owned domain's top pages from the sitemap; cached results with a re-run button.

**Done when:** the audit flags a page blocked to GPTBot and one that needs JavaScript to show its text.

### Day P3: GEO audit, part 2 (is the page ready to be cited?)

- [ ] Content checks: headings that answer questions, lists and tables, schema.org markup (FAQ, Product, Organization, Review), dates, author, word count, and the brand named clearly.
- [ ] A score per page with the reasons, and a comparison with the pages AI actually cites for your prompts (from citations).

**Done when:** every owned page cited or not cited has a score and a list of fixes.

### Day P4: Recommendations and content gaps

- [ ] **Content gap analysis** (Otterly parity): prompts where an engine names competitors but not you, ranked, per engine, with the competitors named and the sources cited for them (often third-party pages to get onto, not pages to write).
- [ ] **Content briefs**: for a gap, a short brief of what a page needs to be cited (topics the cited pages cover, structure, sources to earn), written by a model when a key is set.

- [ ] Weekly, from your own data: prompts where competitors appear and you don't, domains cited for competitors but not for you (outreach targets), owned pages failing the audit, engines where you're slipping.
- [ ] Shown on the Overview and in the weekly email.

**Done when:** the demo workspace gets at least five specific, data-backed recommendations.

### Day P5: Teams, several brands and workspaces ⏸

Deferred (decision log, 20 October 2026).

### Day P6: MCP server

An MCP server, so Claude, ChatGPT, Cursor or any MCP client can read a workspace's results and act on them, Otterly-style.

- [ ] `npm run mcp` (stdio) and an HTTP endpoint (`/api/mcp`, streamable HTTP) authenticated with a per-workspace MCP key, created and revoked in Settings and stored hashed.
- [ ] Read tools: brand and setup, prompts, latest metrics (Brand Visibility Index, mention rate, share of voice, sentiment, position) by engine and country, competitor comparison, citations and top domains, content gaps, recommendations, answers for a prompt, runs and usage.
- [ ] Action tools, owners only: add, pause or delete prompts; start a run (with the free-tier check); run a GEO audit on a URL.
- [ ] Resources: the workspace's prompt list and the latest brand report as markdown.

**Done when:** Claude Desktop, connected to the server, answers "How visible is Ledgerly on Gemini this week, and who beats us?" from real data, and can add a prompt.

### Day P7: Agent analytics and AI referral traffic

- [ ] **Agent analytics** (Otterly parity): which AI crawlers and agents (GPTBot, OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot, Google-Extended, Bingbot for Copilot) fetch which pages, how often, and which pages they never fetch. Collected by a small endpoint fed from Cloudflare/Vercel log drains or an uploaded server log; nothing to install on the page itself.
- [ ] **AI referral traffic**: human visits arriving from chatgpt.com, perplexity.ai, gemini.google.com, copilot.microsoft.com and others, from the same logs or a GA4 connection.

**Done when:** an uploaded access log shows bot visits per page and AI-referred visits per day.

### Day P8: Free public tools

Otterly's free tools are also its marketing. Ours, at `/tools`, need no account:

- [ ] AI crawlability check (from Day P2), content check for a URL (from Day P3), query fan-out for a prompt (ChatGPT's searches, via one Bright Data answer, rate-limited), prompt calculator (how many prompts give a reliable rate), and brand entity check (does AI know your brand: Wikipedia/Wikidata, schema.org Organization, knowledge panel signals).

**Done when:** each tool works logged out and links to sign-up.

### Day P9: Integrations ⏸

Looker Studio connector, public REST API, Slack and webhooks: deferred (decision log, 20 October 2026).

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
| 2. Setup flow ✅ | 11–14 | Onboarding, prompts, configuration |
| 3. Tracking engine | 15–20 | Queued, scheduled, budget-capped runs |
| 4. Analysis | 21–26 | Mentions, sentiment, citations, metrics |
| 5. Dashboard | 27–33 | Every version 1 insight, plus CSV export |
| 5b. Otterly parity | P2–P8 | GEO audit, recommendations and gaps, MCP server, agent analytics, free tools |
| 6. Open-source release | 34–37 | Docker, docs, CI, open core boundary |
| 7. Hosted billing | 38–44 | Wallet, Stripe, Razorpay, enforcement |
| 8. Launch | 45–50 | Production, beta, public release |

**Milestones worth celebrating:**
- **Day 16:** first real run end to end. You're tracking AI visibility.
- **Day 27:** the overview page shows real trends.
- **Day 37:** the open-source version is releasable.
- **Day 49:** public launch.

---

## Otterly parity

Every Otterly feature found on otterly.ai (feature pages, sitemap, pricing; 20 October 2026) and where it lives here. ✅ done · 📅 planned · ⏸ deferred · ✗ not planned.

| Otterly feature | Here |
| --- | --- |
| **Engines:** ChatGPT, AI Overviews, Perplexity, Copilot (core); AI Mode, Gemini, Claude (paid add-ons) | ✅ ChatGPT, Gemini, AI Mode, AI Overviews (no add-on fees). ⏸ Perplexity, Copilot, Claude |
| 65+ countries and languages | ✅ 20 countries (Day 8); more is a one-line change. Prompts in any language |
| Daily tracking | 📅 Day 18 |
| Prompt tracking with tags (branded, non-branded, funnel) and filters | ✅ Days 13, 32 |
| Prompt research (from keywords, brand or URL) | ✅ Day 13 (from brand, category, competitors) |
| Prompt calculator (how many prompts you need) | 📅 Day P8 |
| Query fan-out | 📅 Day 29 (in answers), Day P8 (free tool) |
| Brand mentions, coverage, average position | 📅 Days 21, 24 |
| Brand Visibility Index | 📅 Day 24 |
| Share of voice | 📅 Day 24 |
| Sentiment, Net Sentiment Score | 📅 Days 22, 24 |
| Citation tracking: domains, URLs, link position over time | 📅 Days 23, 30 |
| Domain ranking | 📅 Day 30 |
| Competitor benchmarking (top 5, all) | 📅 Day 31 |
| Content gap analysis | 📅 Day P4 |
| Recommendations (weekly) | 📅 Day P4 |
| Content briefs | 📅 Day P4 |
| GEO audit: crawlability checker | 📅 Day P2 |
| GEO audit: content audit, citation prediction | 📅 Day P3 |
| ChatGPT ads and shopping cards | ⏸ deferred |
| Google AI Overviews ads | ⏸ deferred |
| Agent analytics (AI crawler visits) | 📅 Day P7 |
| AI referral traffic | 📅 Day P7 |
| Brand reports, trend annotations | 📅 Days 27, 31 |
| Exports: CSV, PDF | ✅ Day 32 (PDF through the browser's print dialog) |
| Alerts | ⏸ deferred |
| Looker Studio (Data Studio) connector | ⏸ deferred |
| Public API | ⏸ deferred |
| MCP server | 📅 Day P6 |
| Unlimited team members, brands, competitors | ✅ competitors; ⏸ members and brands |
| Workspaces per client, pitch workspaces | ⏸ deferred |
| Free tools: crawlability, content check, query fan-out, crawler simulation, brand authority | 📅 Day P8 |
| Industry benchmarks (by vertical and country) | ✗ for now: needs data across many customers; possible later on the hosted version |
| AI agent marketplace (Claude skills, n8n templates on the API) | ✗ for now: falls out of the API and MCP once they exist |
| Semrush App Center app | ✗ not planned |
| SSO, enterprise terms | ✗ not planned for version 1 |
| GEO guide, email course, GEO chatbot | ✗ marketing content, not product |

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
| 2026-10-19 | Perplexity: left for now. Bright Data's scraper is refused by Perplexity ("too many requests") from every country and URL tried; Perplexity reportedly blocks shared proxy IPs since August 2026. If revisited: cloro (also covers Copilot; 500 free credits a month) or querying.ai, as one more adapter. | Deferred |
| 2026-10-19 | Target feature parity with Otterly.ai for version 1: alerts, GEO audit, recommendations, teams and several brands, API, query fan-out and ChatGPT ads join the plan (Phase 5b and Day 29). Agent analytics and referral traffic stay in version 2. | Decided |
| 2026-10-19 | Prompt suggestions: built from templates by default (free, offline); an AI model writes them when a key is set. | Decided |
| 2026-10-19 | Queue: no pg-boss. The `run_items` table is the queue, worked by a loop that submits one Bright Data batch per run and engine, checks it, and stores answers; every step is saved, so restarts resume without paying twice. It runs inside the dev server on the embedded database and as `npm run worker` with a real Postgres. Bright Data is batch-shaped (one job per item would be wrong), and pg-boss needs a real Postgres connection. | Decided |
| 2026-10-20 | Full Otterly parity list (every feature page): adds Brand Visibility Index, Net Sentiment Score, trend annotations, link position over time, PDF export, AI Overviews ads and shopping cards, content gaps and briefs, workspaces per client, agent analytics and AI referral traffic (moved from version 2), free public tools and integrations (Days P7–P9). Industry benchmarks, a marketplace, a Semrush app and SSO are left out. | Decided |
| 2026-10-20 | Scope: build every Otterly feature except ads (ChatGPT ads and shopping, AI Overviews ads) and teams, integrations and access (alerts, team members and workspaces, public API, Looker Studio, Slack). The MCP server stays and gets its own day (P6). | Decided |
| | Data source for the hosted version: Bright Data Scale ($1.30 per 1,000) or DataForSEO ($1.20 per 1,000, also covers Claude and AI Overviews) | Decide before Day 38 |
| | Google AI Overviews: version 2 through a SERP API, or skip | Deferred (Bright Data's AI Mode scraper may cover part of it) |
| | Web hosting: Vercel or VPS | Decide on Day 45 |

## Risks to keep in view

- **Usage costs grow with customers.** Enforce budget caps and the wallet from the first hosted user (Days 17 and 42), never later.
- **Scraping breaks the AI companies' terms of service.** Bright Data does the scraping, but OpenVisibility depends on it. Keep the official API as a fallback for every engine and get legal advice before launch.
- **Scraped answers are logged-out answers,** and API answers differ from the apps too. Label every result with its source (consumer app or API) in the dashboard and exports (Days 12 and 33).
- **Competitors can cut prices.** The lasting advantage is the cheap architecture (Day 19) and the underserved audience, not the price alone.
- **Provider details change often.** Keep model IDs and costs in one registry file (Day 10) and re-check them before launch.
