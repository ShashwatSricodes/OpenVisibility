/**
 * Day 1 spike: send one prompt to every engine with web search on, and
 * record what comes back: answer text, citations, tokens, and cost.
 * Raw results are saved to scripts/fixtures/ for the Day 10 tests.
 *
 *   npm run spike
 *   npm run spike -- --preset budget --engine claude,gemini
 *   npm run spike -- --country IN --prompt "best accounting app for freelancers"
 *
 * Needs AI_GATEWAY_API_KEY in .env.local. PERPLEXITY_API_KEY is optional
 * and only used for the Accurate Perplexity preset (direct API).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gateway, generateText, type LanguageModel, type ToolSet } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { createPerplexity } from "@ai-sdk/perplexity";
import { xai } from "@ai-sdk/xai";

type Preset = "accurate" | "budget";
type EngineId = "chatgpt" | "claude" | "gemini" | "perplexity" | "grok";

type Target = {
  /** model passed to generateText: a Gateway id string or a provider model */
  model: LanguageModel;
  /** human-readable id for logs and fixture names */
  label: string;
  tools?: ToolSet;
  /** false when the provider has no way to pass a location */
  usesCountry: boolean;
};

/* Candidate models. "Accurate" should match the model each consumer app
   uses by default, so confirm these against the apps before relying on them.
   Run `npm run models` to see what the Gateway currently offers. */
const MODELS: Record<EngineId, Record<Preset, string>> = {
  chatgpt: { accurate: "openai/gpt-6-sol", budget: "openai/gpt-6-luna" },
  claude: { accurate: "anthropic/claude-sonnet-5.5", budget: "anthropic/claude-haiku-4.5" },
  gemini: { accurate: "google/gemini-3.8-flash", budget: "google/gemini-3.5-flash-lite" },
  grok: { accurate: "spacexai/grok-4.5", budget: "spacexai/grok-4.20-non-reasoning" },
  // the Gateway only lists Sonar; Accurate goes to Perplexity's own API
  perplexity: {
    accurate: process.env.PERPLEXITY_DIRECT_MODEL ?? "sonar-pro",
    budget: "perplexity/sonar",
  },
};

function target(engine: EngineId, preset: Preset, country?: string): Target | null {
  const id = MODELS[engine][preset];
  const location = country ? { type: "approximate" as const, country } : undefined;

  switch (engine) {
    case "chatgpt":
      return {
        model: id,
        label: id,
        tools: { web_search: openai.tools.webSearch({ userLocation: location }) },
        usesCountry: true,
      };
    case "claude":
      return {
        model: id,
        label: id,
        tools: {
          web_search: anthropic.tools.webSearch_20250305({ maxUses: 3, userLocation: location }),
        },
        usesCountry: true,
      };
    case "gemini":
      // Google Search grounding takes no location parameter
      return {
        model: id,
        label: id,
        tools: { google_search: google.tools.googleSearch({}) },
        usesCountry: false,
      };
    case "grok":
      // xAI web search takes domain filters but no location
      return {
        model: id,
        label: id,
        tools: { web_search: xai.tools.webSearch({}) },
        usesCountry: false,
      };
    case "perplexity":
      if (preset === "budget") {
        // Sonar searches on every request; no tool needed
        return { model: id, label: id, usesCountry: false };
      }
      if (!process.env.PERPLEXITY_API_KEY) return null;
      return {
        model: createPerplexity({ apiKey: process.env.PERPLEXITY_API_KEY })(id),
        label: `perplexity-direct/${id}`,
        usesCountry: false,
      };
  }
}

type Row = {
  engine: EngineId;
  preset: Preset;
  model: string;
  ok: boolean;
  ms: number;
  inputTokens?: number;
  outputTokens?: number;
  sources?: number;
  searches?: number;
  metadataCost?: unknown;
  lookupCost?: number;
  error?: string;
};

/** Usage is ingested asynchronously, so the lookup 404s for a few seconds. */
async function lookupGeneration(id: string) {
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await gateway.getGenerationInfo({ id });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status !== 404 || attempt === 9) throw err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  if (!process.env.AI_GATEWAY_API_KEY) {
    console.error("Set AI_GATEWAY_API_KEY in .env.local first (see .env.example).");
    process.exit(1);
  }

  const prompt = arg("prompt") ?? "What is the best invoicing software for freelancers?";
  const country = arg("country");
  const presetArg = arg("preset") ?? "both";
  const presets: Preset[] = presetArg === "both" ? ["accurate", "budget"] : [presetArg as Preset];
  const engines = (arg("engine")?.split(",") ?? Object.keys(MODELS)) as EngineId[];

  const outDir = join(process.cwd(), "scripts", "fixtures");
  mkdirSync(outDir, { recursive: true });

  console.log(`Prompt:  ${prompt}`);
  console.log(`Country: ${country ?? "(none)"}\n`);

  const rows: Row[] = [];

  for (const engine of engines) {
    for (const preset of presets) {
      const t = target(engine, preset, country);
      if (!t) {
        console.log(`- ${engine}/${preset}: skipped (no PERPLEXITY_API_KEY)`);
        continue;
      }
      const started = Date.now();
      try {
        const result = await generateText({
          model: t.model,
          prompt,
          tools: t.tools,
          providerOptions: { gateway: { tags: ["spike", `engine:${engine}`, `preset:${preset}`] } },
        });
        const ms = Date.now() - started;

        const gw = result.providerMetadata?.gateway as Record<string, unknown> | undefined;
        const generationId = typeof gw?.generationId === "string" ? gw.generationId : undefined;
        const generation = generationId ? await lookupGeneration(generationId) : undefined;

        const sources = result.sources.map((s) =>
          s.sourceType === "url" ? { url: s.url, title: s.title } : { title: s.title },
        );

        rows.push({
          engine,
          preset,
          model: t.label,
          ok: true,
          ms,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          sources: sources.length,
          searches: generation?.billableWebSearchCalls,
          metadataCost: gw?.cost,
          lookupCost: generation?.totalCost,
        });

        writeFileSync(
          join(outDir, `${engine}-${preset}.json`),
          JSON.stringify(
            {
              capturedAt: new Date().toISOString(),
              engine,
              preset,
              model: t.label,
              prompt,
              country: country ?? null,
              countryApplied: Boolean(country && t.usesCountry),
              text: result.text,
              sources,
              usage: result.usage,
              finishReason: result.finishReason,
              providerMetadata: result.providerMetadata,
              generation,
              content: result.content,
            },
            null,
            2,
          ),
        );
        console.log(`✓ ${engine}/${preset} (${t.label}): ${ms} ms, ${sources.length} sources`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        rows.push({ engine, preset, model: t.label, ok: false, ms: Date.now() - started, error: message });
        console.log(`✗ ${engine}/${preset} (${t.label}): ${message}`);
      }
    }
  }

  console.log("\nSummary");
  console.table(
    rows.map((r) => ({
      engine: r.engine,
      preset: r.preset,
      model: r.model,
      ok: r.ok ? "yes" : "NO",
      ms: r.ms,
      "in tok": r.inputTokens,
      "out tok": r.outputTokens,
      sources: r.sources,
      searches: r.searches,
      "cost (metadata)": r.metadataCost,
      "cost (lookup)": r.lookupCost !== undefined ? `$${r.lookupCost.toFixed(5)}` : undefined,
    })),
  );
  console.log(`Fixtures saved to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
