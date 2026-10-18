/**
 * Day 1 spike, consumer-app route: run a prompt through Bright Data's
 * scrapers (ChatGPT, Gemini, Google AI Mode, Google AI Overviews,
 * Perplexity, Copilot) and show what comes back.
 * Raw results are saved to scripts/fixtures/ for the Day 10 tests.
 *
 *   npm run spike:bd
 *   npm run spike:bd -- --engine chatgpt,ai_overviews --country US
 *   npm run spike:bd -- --prompt "best accounting app for freelancers" --brand Zoho
 *
 * Each prompt × engine uses one record of the free 5,000 a month
 * (failed records aren't billed).
 * Needs BRIGHT_DATA_API_KEY in .env.local.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BrightDataClient,
  BRIGHT_DATA_DATASETS,
  type BrightDataEngine,
  type Citation,
} from "../core/providers/brightdata";

type Outcome = {
  engine: string;
  seconds: number;
  ok: boolean;
  error?: string;
  text: string;
  citations: Citation[];
  links?: number;
  model?: string;
  searched?: boolean;
  /** AI Overviews only: whether Google showed one at all */
  shown?: boolean;
};

const ENGINES = Object.keys(BRIGHT_DATA_DATASETS);

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
  const engines = arg("engine")?.split(",") ?? ["chatgpt", "gemini", "ai_mode", "ai_overviews"];

  for (const e of engines) {
    if (!ENGINES.includes(e)) {
      console.error(`Unknown engine "${e}". Use: ${ENGINES.join(", ")}`);
      process.exit(1);
    }
  }

  const client = new BrightDataClient(key);
  const outDir = join(process.cwd(), "scripts", "fixtures");
  mkdirSync(outDir, { recursive: true });
  const save = (engine: string, data: object) =>
    writeFileSync(
      join(outDir, `brightdata-${engine}.json`),
      JSON.stringify(
        { capturedAt: new Date().toISOString(), engine, prompt, country: country ?? null, ...data },
        null,
        2,
      ),
    );

  console.log(`Prompt:  ${prompt}`);
  console.log(`Country: ${country ?? "(default)"}`);
  console.log(`Engines: ${engines.join(", ")} (${engines.length} free-tier records)\n`);

  async function runOne(engine: string): Promise<Outcome> {
    const started = Date.now();
    const elapsed = () => Math.round((Date.now() - started) / 1000);
    try {
      const { snapshotId, answers } = await client.run(
        engine as BrightDataEngine,
        [{ prompt, country, webSearch: true }],
        {
          onStatus: (s) => console.log(`  ${engine.padEnd(12)} ${s} (${elapsed()}s)`),
        },
      );
      save(engine, { snapshotId, seconds: elapsed(), answers });
      const a = answers[0];
      if (!a)
        return {
          engine,
          seconds: elapsed(),
          ok: false,
          error: "no records returned",
          text: "",
          citations: [],
        };
      return {
        engine,
        seconds: elapsed(),
        ok: a.ok,
        error: a.error,
        text: a.text,
        citations: a.citations,
        links: a.links.length,
        model: a.model,
        searched: a.webSearchTriggered,
        shown: a.shown,
      };
    } catch (err) {
      return {
        engine,
        seconds: elapsed(),
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        text: "",
        citations: [],
      };
    }
  }

  // one batch per engine, all engines in parallel
  const results = await Promise.all(engines.map(runOne));

  for (const r of results) {
    console.log(`\n── ${r.engine} ─────────────────────────────`);
    if (r.error) console.log(`✗ ${r.error}`);
    if (r.shown === false && r.ok) console.log("(Google showed no AI Overview for this query)");
    if (r.text) console.log(r.text.slice(0, 600) + (r.text.length > 600 ? " …" : ""));
    if (r.citations.length) {
      console.log("\nCitations:");
      for (const c of r.citations.slice(0, 8))
        console.log(`  ${c.position ?? "-"}. ${c.title ?? ""} ${c.url}`);
      if (r.citations.length > 8) console.log(`  … ${r.citations.length - 8} more`);
    }
  }

  const mentions = (text: string) =>
    brand ? new RegExp(`\\b${brand}\\b`, "i").test(text) : undefined;

  console.log("\nSummary");
  console.table(
    results.map((r) => ({
      engine: r.engine,
      ok: r.ok ? "yes" : "NO",
      seconds: r.seconds,
      chars: r.text.length,
      citations: r.citations.length,
      links: r.links,
      model: r.model,
      "searched?": r.searched ?? r.shown,
      ...(brand ? { [`mentions ${brand}`]: mentions(r.text) } : {}),
      error: r.error?.slice(0, 60),
    })),
  );
  console.log(`Fixtures saved to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
