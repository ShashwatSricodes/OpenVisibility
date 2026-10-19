/**
 * Ask one prompt on one or more engines through the provider layer and print
 * the normalized result: the same path a tracking run takes.
 *
 *   npm run try -- chatgpt "best invoicing app"
 *   npm run try -- chatgpt,ai_mode "best invoicing app" --country US
 *   npm run try -- ai_overviews "best invoicing app" --brand Zoho --save
 *
 * Each engine uses one answer of Bright Data's free 5,000 a month (failed
 * answers aren't billed). --save writes the result to scripts/fixtures/ for
 * the tests. Needs BRIGHT_DATA_API_KEY in .env.local.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ENGINES,
  ProviderError,
  engineIds,
  getProvider,
  isEngineId,
  query,
  type EngineId,
  type QueryResult,
} from "../core/providers";

function flag(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const usage = `Usage: npm run try -- <engine[,engine]> "<prompt>" [--country US] [--brand Name] [--save]
Engines: ${engineIds.filter((e) => ENGINES[e].provider).join(", ")}`;

async function main() {
  const positional = process.argv.slice(2).filter((a, i, all) => {
    if (a.startsWith("--")) return false;
    const prev = all[i - 1];
    return !(prev === "--country" || prev === "--brand");
  });
  const [engineArg, prompt] = positional;
  if (!engineArg || !prompt) {
    console.error(usage);
    process.exit(1);
  }
  const engines = engineArg.split(",");
  for (const e of engines) {
    if (!isEngineId(e)) {
      console.error(`Unknown engine "${e}".\n${usage}`);
      process.exit(1);
    }
  }
  const country = flag("country")?.toUpperCase();
  const brand = flag("brand");
  const save = process.argv.includes("--save");

  console.log(`Prompt:  ${prompt}`);
  console.log(`Country: ${country ?? "(default)"}\n`);

  // one batch per engine, all engines in parallel
  const outcomes = await Promise.all(
    (engines as EngineId[]).map(async (engine) => {
      const started = Date.now();
      const seconds = () => Math.round((Date.now() - started) / 1000);
      try {
        const provider = getProvider(engine);
        const { jobId, results } = await query(provider, engine, [{ prompt, country }], {
          onState: (s) => console.log(`  ${engine.padEnd(12)} ${s} (${seconds()}s)`),
        });
        if (save) {
          const dir = join(process.cwd(), "scripts", "fixtures");
          mkdirSync(dir, { recursive: true });
          writeFileSync(
            join(dir, `${provider.id}-${engine}.json`),
            JSON.stringify(
              {
                capturedAt: new Date().toISOString(),
                engine,
                prompt,
                country: country ?? null,
                snapshotId: jobId,
                seconds: seconds(),
                answers: results,
              },
              null,
              2,
            ),
          );
        }
        return { engine, seconds: seconds(), result: results[0] };
      } catch (err) {
        const message = err instanceof ProviderError ? `${err.kind}: ${err.message}` : String(err);
        return { engine, seconds: seconds(), failure: message };
      }
    }),
  );

  for (const o of outcomes) print(o.engine, o.result, o.failure);

  const mentions = (text: string) =>
    brand ? new RegExp(`\\b${brand}\\b`, "i").test(text) : undefined;
  console.log("\nSummary");
  console.table(
    outcomes.map(({ engine, seconds, result: r, failure }) => ({
      engine,
      ok: r?.ok ? "yes" : "NO",
      seconds,
      chars: r?.text.length ?? 0,
      citations: r?.citations.length ?? 0,
      links: r?.links.length ?? 0,
      model: r?.model,
      "searched?": r?.webSearchTriggered ?? r?.shown,
      ...(brand ? { [`mentions ${brand}`]: r ? mentions(r.text) : undefined } : {}),
      cost: r ? `$${r.costUsd}` : undefined,
      error: (failure ?? r?.error?.message)?.slice(0, 60),
    })),
  );
}

function print(engine: EngineId, r?: QueryResult, failure?: string) {
  console.log(`\n── ${ENGINES[engine].name} ─────────────────────────────`);
  if (failure) return console.log(`✗ ${failure}`);
  if (!r) return;
  if (r.error) console.log(`✗ ${r.error.kind}: ${r.error.message}`);
  if (r.shown === false && r.ok) console.log("(Google showed no AI Overview for this search)");
  if (r.text) console.log(r.text.slice(0, 600) + (r.text.length > 600 ? " …" : ""));
  if (r.citations.length) {
    console.log("\nCitations:");
    for (const c of r.citations.slice(0, 8))
      console.log(`  ${c.position ?? "-"}. ${c.title ?? ""} ${c.url}`);
    if (r.citations.length > 8) console.log(`  … ${r.citations.length - 8} more`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
