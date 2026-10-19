/**
 * Ask one prompt through the provider layer and print the normalized result:
 * the same path a tracking run takes.
 *
 *   npm run try -- chatgpt "best invoicing app"
 *   npm run try -- chatgpt,ai_mode "best invoicing app" --country US
 *   npm run try -- ai_overviews "best invoicing app" --brand Zoho --save
 *   npm run try -- --workspace "Demo workspace" "best invoicing app" --dry-run
 *
 * --workspace uses that workspace's engines, countries and Bright Data key
 * (Settings), as a run would; with the embedded database, stop the dev
 * server first. --dry-run prints the plan without asking anything.
 *
 * Each engine × country uses one answer of Bright Data's free 5,000 a month
 * (failed answers aren't billed). --save writes results to scripts/fixtures/
 * for the tests.
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
  type ProviderKeys,
  type QueryResult,
} from "../core/providers";

const VALUE_FLAGS = ["--country", "--brand", "--workspace"];

function flag(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const usage = `Usage:
  npm run try -- <engine[,engine]> "<prompt>" [--country US] [--brand Name] [--save]
  npm run try -- --workspace "<name>" "<prompt>" [--brand Name] [--dry-run]
Engines: ${engineIds.filter((e) => ENGINES[e].provider).join(", ")}`;

type Plan = { engines: EngineId[]; countries: (string | undefined)[]; keys: ProviderKeys };

function fail(message: string): never {
  console.error(`${message}\n\n${usage}`);
  process.exit(1);
}

/** A workspace's engines, countries and key, as a tracking run would use them. */
async function planFromWorkspace(name: string): Promise<Plan & { keySource: string | null }> {
  const { eq } = await import("drizzle-orm");
  const { getDb, prepareDb } = await import("../db/client");
  const { workspaces } = await import("../db/schema");
  const { getTrackingConfig } = await import("../core/tracking-config");
  const { resolveProviderKeys } = await import("../core/credentials");

  await prepareDb();
  const db = getDb();
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.name, name)).limit(1);
  if (!workspace) fail(`No workspace named "${name}".`);
  const config = await getTrackingConfig(db, workspace.id);
  const { keys, source } = await resolveProviderKeys(db, workspace.id);
  return { ...config, keys, keySource: source.brightData };
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter(
    (a, i) => !a.startsWith("--") && !VALUE_FLAGS.includes(args[i - 1]),
  );
  const workspace = flag("workspace");
  const brand = flag("brand");
  const save = process.argv.includes("--save");
  const dryRun = process.argv.includes("--dry-run");

  let prompt: string | undefined;
  let plan: Plan;
  if (workspace) {
    prompt = positional[0];
    if (!prompt) fail("Give a prompt to ask.");
    const p = await planFromWorkspace(workspace);
    plan = p;
    console.log(`Workspace: ${workspace} (Bright Data key: ${p.keySource ?? "none"})`);
  } else {
    const [engineArg, text] = positional;
    prompt = text;
    if (!engineArg || !prompt) fail("Give engines and a prompt.");
    const engines = engineArg.split(",");
    const unknown = engines.find((e) => !isEngineId(e));
    if (unknown) fail(`Unknown engine "${unknown}".`);
    plan = {
      engines: engines as EngineId[],
      countries: [flag("country")?.toUpperCase()],
      keys: {},
    };
  }

  const answers = plan.engines.length * plan.countries.length;
  console.log(`Prompt:    ${prompt}`);
  console.log(`Engines:   ${plan.engines.map((e) => ENGINES[e].name).join(", ")}`);
  console.log(`Countries: ${plan.countries.map((c) => c ?? "(default)").join(", ")}`);
  console.log(`Answers:   ${answers} (one per engine per country)\n`);
  if (dryRun) {
    console.log("Dry run: nothing was asked.");
    process.exit(0);
  }

  // one batch per engine, holding every country; all engines in parallel
  const inputs = plan.countries.map((country) => ({ prompt: prompt!, country }));
  const outcomes = (
    await Promise.all(
      plan.engines.map(async (engine) => {
        const started = Date.now();
        const seconds = () => Math.round((Date.now() - started) / 1000);
        try {
          const provider = getProvider(engine, plan.keys);
          const { jobId, results } = await query(provider, engine, inputs, {
            onState: (s) => console.log(`  ${engine.padEnd(12)} ${s} (${seconds()}s)`),
          });
          if (save) saveFixture(provider.id, engine, prompt!, jobId, seconds(), results);
          return results.map((result) => ({ engine, seconds: seconds(), result }));
        } catch (err) {
          const message =
            err instanceof ProviderError ? `${err.kind}: ${err.message}` : String(err);
          return [{ engine, seconds: seconds(), failure: message }];
        }
      }),
    )
  ).flat() as { engine: EngineId; seconds: number; result?: QueryResult; failure?: string }[];

  for (const o of outcomes) print(o.engine, o.result, o.failure);

  const mentions = (text: string) =>
    brand ? new RegExp(`\\b${brand}\\b`, "i").test(text) : undefined;
  console.log("\nSummary");
  console.table(
    outcomes.map(({ engine, seconds, result: r, failure }) => ({
      engine,
      country: r?.country,
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
  process.exit(0);
}

function saveFixture(
  providerId: string,
  engine: EngineId,
  prompt: string,
  jobId: string,
  seconds: number,
  results: QueryResult[],
) {
  const dir = join(process.cwd(), "scripts", "fixtures");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${providerId}-${engine}.json`),
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        engine,
        prompt,
        country: results[0]?.country ?? null,
        snapshotId: jobId,
        seconds,
        answers: results,
      },
      null,
      2,
    ),
  );
}

function print(engine: EngineId, r?: QueryResult, failure?: string) {
  const where = r?.country ? ` (${r.country})` : "";
  console.log(`\n── ${ENGINES[engine].name}${where} ─────────────────────────────`);
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
