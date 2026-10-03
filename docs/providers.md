# Providers

How OpenVisibility reaches each AI engine, what each one returns, and what a call costs. Checked against the Vercel AI Gateway on 3 October 2026. Prices change often, so re-run `npm run models` before trusting the numbers below.

## Summary

| Engine | Gateway prefix | Search method | Search price | Location support | Status |
| --- | --- | --- | --- | --- | --- |
| ChatGPT | `openai/` | `openai.tools.webSearch()` | $10 / 1k searches | Yes (`userLocation.country`) | Listed; spike pending |
| Claude | `anthropic/` | `anthropic.tools.webSearch_20250305()` | $10 / 1k searches | Yes (`userLocation.country`) | Listed; spike pending |
| Gemini | `google/` | `google.tools.googleSearch()` (grounding) | $14 / 1k on Gemini 3.x, $35 / 1k on 2.5 | **No parameter** | Listed; spike pending |
| Grok | **`spacexai/`** (not `xai/`) | `xai.tools.webSearch()` | $5 / 1k searches | **No parameter** | Listed; spike pending |
| Perplexity | `perplexity/` | Built in; every Sonar call searches | $2.50 / 1k requests | Not through the Gateway | **Only Sonar is listed** |

Search prices come from the `web_search` field of the public model list (`GET https://ai-gateway.vercel.sh/v1/models`). The figure is US dollars per 1,000 searches, and it's charged on top of token costs.

## Data sources

Each engine can be reached two ways. The source is a per-engine setting.

| Source | What it measures | Engines | Cost per answer | Self-hosted free tier |
| --- | --- | --- | --- | --- |
| **Consumer app** via [Bright Data](https://brightdata.com/pricing/web-scraper) scrapers | What a logged-out user sees in the real app | ChatGPT, Gemini, Perplexity, Grok, Copilot, Google AI Mode | $0.0015 (pay as you go), $0.0013 on the $499/mo plan | **5,000 answers a month per account**, no card, resets on the 1st, no rollover |
| **Official API** via Vercel AI Gateway or direct keys | How the model responds through its API | All five, including Claude | ~$0.01–0.03 (mostly search fees and search-result tokens) | None |

**Default for self-hosting** (decided 3 October 2026): consumer app for ChatGPT, Gemini and Perplexity; official API for Claude, which Bright Data can't reach because it requires a login. With each prompt asked 3× a run, 15 prompts daily on those three engines uses 4,050 answers a month, inside the free tier.

How Bright Data works: send a batch of prompts (`POST https://api.brightdata.com/datasets/v3/scrape?dataset_id=…`), poll the snapshot's progress, then download the results as JSON. Each platform has its own dataset ID and slightly different output fields (`answer_text`, `citations` or `sources`, `country`), so the adapter normalizes them. ChatGPT also accepts a web search toggle, a country, and latitude/longitude.

Caveats:

- Scraping breaks OpenAI's and Google's terms of service. Bright Data carries out the scraping, but get legal advice before launch.
- Scraped answers come from logged-out sessions, which may use a different model from a paying subscriber's.
- Speed isn't published. Jobs are asynchronous, so plan for minutes per batch.

Alternative for the hosted version: [DataForSEO](https://dataforseo.com/apis/ai-optimization-api) scrapes ChatGPT, Gemini and Perplexity for $0.0012 per answer, and reaches Claude through its official-API endpoint. There's no free tier ($1 credit, then a $50 minimum top-up), which is why it isn't the self-hosted default.

## Search pricing, checked against each provider

All search fees are per **1,000** searches, so $10 means **$0.01 per search**. Checked on 3 October 2026.

| Engine | Gateway lists | Provider's own price | Search result tokens |
| --- | --- | --- | --- |
| ChatGPT | $10 / 1k | $10 / 1k calls | Billed at model rates on reasoning models (GPT-5 and later); free on non-reasoning models |
| Claude | $10 / 1k | $10 / 1k searches | Billed as input tokens, often ~6,000 per search |
| Gemini 3.x | $14 / 1k | $14 / 1k **queries** (one prompt can run several) | Normal token rates |
| Gemini 2.5 | $35 / 1k | $35 / 1k **prompts** | Normal token rates |
| Grok | $5 / 1k | $5 / 1k calls | Normal token rates |
| Perplexity Sonar | $2.50 / 1k, tokens $0.25 / $2.50 per M | **$5–12 / 1k requests** (by search context size), tokens $1 / $1 per M | Included |

**The search fee is not the biggest cost.** Search results are pasted into the model's input, so a single Claude search can add thousands of input tokens. Rough per-call estimates for one search and a ~1,000-token answer:

| Engine | Accurate | Budget |
| --- | --- | --- |
| ChatGPT | ~$0.03 | ~$0.011 |
| Claude | ~$0.03 | ~$0.02 |
| Gemini | ~$0.02–0.03 | ~$0.015–0.03 |
| Grok | ~$0.02 | ~$0.015 |
| Perplexity | n/a | ~$0.004 |

These are estimates; the spike replaces them with measured numbers.

Consequences:

- **The search fee sets a floor** of about $0.005–0.014 per call that Budget models can't get below. Budget saves on tokens, not on search.
- **The landing page estimator is probably too low.** It assumes $0.018 (Accurate) and $0.006 (Budget) per call; $0.006 is below the search fee alone for ChatGPT, Claude and Gemini. Update it from the spike results.
- **Cost levers:** cap Claude's searches with `maxUses` (1–2 is enough for one prompt), set OpenAI's `searchContextSize: "low"`, and watch Gemini 3.x, which bills per query and may run several per prompt.
- **Perplexity mismatch:** the Gateway's Sonar price is well below Perplexity's own published price. The spike's measured cost will show which is real.

Sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Anthropic web search tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool), [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), [Perplexity pricing](https://docs.perplexity.ai/getting-started/pricing), [xAI pricing guide (third-party)](https://mem0.ai/blog/xai-grok-api-pricing).

## Findings

### 1. Perplexity: only Sonar is on the Gateway

The Gateway lists `perplexity/sonar` and no other Perplexity chat model. That settles the open question in the product plan:

- **Budget preset:** `perplexity/sonar` through the Gateway. It's cheap ($0.25/M input, $2.50/M output, $2.50 per 1k requests) and searches on every call.
- **Accurate preset:** needs Perplexity's own API, where Sonar Pro is still sold ($3 / $15 per M tokens plus $6–14 per 1k requests). The current `@ai-sdk/perplexity` package (v5) targets Perplexity's **Agent API**, which also offers presets (`fast` to `xhigh`). The spike tries `sonar-pro` first; if the Agent API rejects that name, try a preset via `PERPLEXITY_DIRECT_MODEL`.
- `perplexity/sonar` has **no zero-data-retention** support (`"zdr": "none"`). Keep that in mind for the hosted ZDR option on Day 44.
- Don't use `gateway.tools.perplexitySearch()`: it gives *other* models Perplexity's search results, so it doesn't measure Perplexity at all.

### 2. xAI models are listed as `spacexai/`

Grok models are under the `spacexai/` prefix. Only some of them support web search:

- With search: `grok-4.20-*`, `grok-4.3`, `grok-4.5`, `grok-build-0.1`
- **Without search:** `grok-4.6`, `grok-4.7`, `grok-4.1-fast-*`, despite being newer

The engine registry must check the `web-search` tag rather than assume the newest model works.

### 3. Country targeting is uneven

| Engine | How to pass the country |
| --- | --- |
| ChatGPT | `webSearch({ userLocation: { type: "approximate", country: "IN" } })` |
| Claude | `webSearch_20250305({ userLocation: { type: "approximate", country: "IN" } })` |
| Gemini | No parameter. Options: phrase the prompt for the country, or record the answer as global. |
| Grok | No parameter (only domain filters). Same options as Gemini. |
| Perplexity (direct API) | `web_search` tool `user_location.country` on the Agent API |
| Perplexity (Gateway Sonar) | Not exposed |

The product must show when a result for a country is *not* truly location-targeted, rather than implying all engines were asked from that country.

### 4. Getting the exact cost

- Every AI SDK response carries `providerMetadata.gateway.generationId`.
- `gateway.getGenerationInfo({ id })` returns `totalCost` (USD), token counts, `billableWebSearchCalls` and the provider that served it.
- The lookup is **asynchronous**: it returns 404 for a few seconds after the call, so it has to be retried.
- **Still to confirm:** the product plan assumes `providerMetadata.gateway.cost` is on the response itself. The SDK types it as an open JSON object, so the spike prints it. If it's missing, the worker records cost through the generation lookup instead (a deferred job a few seconds after each answer).

## Candidate models

"Accurate" should match the model each consumer app uses by default; "Budget" is the cheapest model that still supports search. **These are guesses until confirmed against the apps.** They live at the top of `scripts/spike.ts` and move to `core/providers/registry.ts` on Day 10.

| Engine | Accurate | Budget |
| --- | --- | --- |
| ChatGPT | `openai/gpt-6-sol` ($2 / $10 per M) | `openai/gpt-6-luna` ($0.10 / $0.50 per M) |
| Claude | `anthropic/claude-sonnet-5.5` ($2 / $10) | `anthropic/claude-haiku-4.5` ($1 / $5) |
| Gemini | `google/gemini-3.8-flash` ($0.75 / $3.75) | `google/gemini-3.5-flash-lite` ($0.30 / $2.50) |
| Grok | `spacexai/grok-4.5` ($2 / $6) | `spacexai/grok-4.20-non-reasoning` ($1.25 / $2.50) |
| Perplexity | Direct API (preset to choose) | `perplexity/sonar` ($0.25 / $2.50) |

## Measured results

Fill this in from `npm run spike`. Search tools pull result pages into the model's context, so input tokens (and cost) are usually much higher than the prompt alone.

| Engine | Preset | Model | Cost per call | Searches | Sources | Latency | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ChatGPT | Accurate | | | | | | |
| ChatGPT | Budget | | | | | | |
| Claude | Accurate | | | | | | |
| Claude | Budget | | | | | | |
| Gemini | Accurate | | | | | | |
| Gemini | Budget | | | | | | |
| Grok | Accurate | | | | | | |
| Grok | Budget | | | | | | |
| Perplexity | Accurate | | | | | | |
| Perplexity | Budget | | | | | | |

Questions to answer from the fixtures:

- [ ] Is `providerMetadata.gateway.cost` present, and does it match `totalCost` from the lookup?
- [ ] Does every engine return citations in `result.sources`, or are some only inside the answer text?
- [ ] For ChatGPT and Claude, does passing `country` visibly change the answer?
- [ ] How many searches does each engine make per prompt? Claude is capped at 3 by `maxUses`.

## How to reproduce

```bash
npm run models                 # list search-capable models and prices (no key needed)
cp .env.example .env.local     # then add AI_GATEWAY_API_KEY
npm run spike                  # both presets, all engines
npm run spike -- --preset budget --country IN
```

Raw responses are saved in `scripts/fixtures/` and become test fixtures on Day 10.

## Sources

- [AI Gateway web search](https://vercel.com/docs/ai-gateway/models-and-providers/web-search)
- [AI Gateway generation lookup](https://vercel.com/docs/ai-gateway/observability-and-spend/usage)
- [AI Gateway provider for the AI SDK](https://ai-sdk.dev/providers/ai-sdk-providers/ai-gateway)
- Public model list: `https://ai-gateway.vercel.sh/v1/models`
