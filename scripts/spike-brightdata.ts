/**
 * Day 1 spike, consumer-app route: run prompts through Bright Data's
 * ChatGPT, Perplexity and Gemini scrapers and show what comes back.
 * Raw results are saved to scripts/fixtures/ for the Day 10 tests.
 *
 *   npm run spike:bd
 *   npm run spike:bd -- --engine chatgpt --country in
 *   npm run spike:bd -- --prompt "best accounting app for freelancers" --brand Zoho
 *
 * Each prompt × engine uses one record of the free 5,000 a month.
 * Needs BRIGHT_DATA_API_KEY in .env.local.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BrightDataClient,
  BRIGHT_DATA_DATASETS,
  type BrightDataAnswer,
  type BrightDataEngine,
} from "../core/providers/brightdata";

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const key = process.env.BRIGHT_DATA_API_KEY;
  if (!key) {
    console.error("Set BRIGHT_DATA_API_KEY in .env.local first (see .env.example).");
    process.exit(1);
  }

  const prompt = arg("prompt") ?? "What is the best invoicing software for freelancers?";
  const country = arg("country");
  const brand = arg("brand");
  const engines = (arg("engine")?.split(",") ?? ["chatgpt", "perplexity", "gemini"]) as BrightDataEngine[];

  for (const e of engines) {
    if (!(e in BRIGHT_DATA_DATASETS)) {
      console.error(`Unknown engine "${e}". Use: ${Object.keys(BRIGHT_DATA_DATASETS).join(", ")}`);
      process.exit(1);
    }
  }

  const client = new BrightDataClient(key);
  const outDir = join(process.cwd(), "scripts", "fixtures");
  mkdirSync(outDir, { recursive: true });

  console.log(`Prompt:  ${prompt}`);
  console.log(`Country: ${country ?? "(Bright Data default)"}`);
  console.log(`Engines: ${engines.join(", ")} (${engines.length} free-tier records)\n`);

  // one batch per engine, all engines in parallel
  const results = await Promise.all(
    engines.map(async (engine) => {
      const started = Date.now();
      try {
        const { snapshotId, answers } = await client.run(engine, [{ prompt, country, webSearch: true }], {
          onStatus: (s) => console.log(`  ${engine.padEnd(10)} ${s} (${Math.round((Date.now() - started) / 1000)}s)`),
        });
        const seconds = Math.round((Date.now() - started) / 1000);
        writeFileSync(
          join(outDir, `brightdata-${engine}.json`),
          JSON.stringify({ capturedAt: new Date().toISOString(), engine, prompt, country: country ?? null, snapshotId, seconds, answers }, null, 2),
        );
        return { engine, seconds, answer: answers[0] as BrightDataAnswer | undefined };
      } catch (err) {
        return { engine, seconds: Math.round((Date.now() - started) / 1000), error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  for (const r of results) {
    console.log(`\n── ${r.engine} ─────────────────────────────`);
    if ("error" in r && r.error) {
      console.log(`✗ ${r.error}`);
      continue;
    }
    const a = "answer" in r ? r.answer : undefined;
    if (!a) {
      console.log("✗ no records returned");
      continue;
    }
    if (!a.ok) console.log(`✗ ${a.error}`);
    console.log(a.text.slice(0, 600) + (a.text.length > 600 ? " …" : ""));
    console.log("\nCitations:");
    for (const c of a.citations.slice(0, 8)) console.log(`  ${c.position ?? "-"}. ${c.title ?? ""} ${c.url}`);
    if (a.citations.length > 8) console.log(`  … ${a.citations.length - 8} more`);
  }

  console.log("\nSummary");
  console.table(
    results.map((r) => {
      const a = "answer" in r ? r.answer : undefined;
      return {
        engine: r.engine,
        ok: a?.ok ? "yes" : "NO",
        seconds: r.seconds,
        chars: a?.text.length,
        citations: a?.citations.length,
        links: a?.links.length,
        model: a?.model,
        "searched?": a?.webSearchTriggered,
        ...(brand ? { [`mentions ${brand}`]: a ? new RegExp(`\\b${brand}\\b`, "i").test(a.text) : undefined } : {}),
        error: "error" in r ? r.error?.slice(0, 60) : a?.error,
      };
    }),
  );
  console.log(`Fixtures saved to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
