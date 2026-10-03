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

## Findings

### 1. Perplexity: only Sonar is on the Gateway

The Gateway lists `perplexity/sonar` and no other Perplexity chat model. That settles the open question in the product plan:

- **Budget preset:** `perplexity/sonar` through the Gateway. It's cheap ($0.25/M input, $2.50/M output, $2.50 per 1k requests) and searches on every call.
- **Accurate preset:** needs Perplexity's own API. The current `@ai-sdk/perplexity` package (v5) targets Perplexity's **Agent API**, which takes presets (`fast`, `low`, `medium`, `high`, `xhigh`) rather than named Sonar Pro models. Which preset best matches the Perplexity app still has to be decided.
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
