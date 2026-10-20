/**
 * Accuracy spot check: random stored answers next to the mentions found in
 * them, for a person to read and judge. Each answer shows:
 *
 * - the text, with every detected mention marked «like this»
 * - the brands found, in rank order, with the sentence around each
 * - "not counted": every other place a tracked name appears in any case
 *   (a lowercase common word, a name inside someone else's URL…), so a
 *   missed mention is easy to spot
 * - "stored differs" when the database holds different mentions than the
 *   detector finds now (run `npm run reanalyze` to apply fixes)
 *
 *   npm run spot-check                         20 answers from the first workspace
 *   npm run spot-check -- --workspace "Demo" --n 10 --full
 *   npm run spot-check -- --fixtures           the saved real answers in scripts/fixtures
 *
 * With the embedded database, stop `npm run dev` first: one process at a time.
 */

import { readFileSync, readdirSync } from "node:fs";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { detectMentions, type Entity } from "../core/mentions";

const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const N = Number(flag("n") ?? 20);
const FULL = process.argv.includes("--full");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

type Answer = { label: string; text: string; stored?: string[] };

/** A brand set for the fixtures, which ask about invoicing software. */
const FIXTURE_BRANDS: Entity[] = [
  { competitorId: null, name: "FreshBooks", aliases: [], domains: ["freshbooks.com"] },
  { competitorId: "Wave", name: "Wave", aliases: [], domains: ["waveapps.com"] },
  { competitorId: "Zoho Invoice", name: "Zoho Invoice", aliases: ["Zoho"], domains: ["zoho.com"] },
  {
    competitorId: "QuickBooks",
    name: "QuickBooks",
    aliases: [],
    domains: ["quickbooks.intuit.com"],
  },
  { competitorId: "Bonsai", name: "Bonsai", aliases: [], domains: ["hellobonsai.com"] },
  { competitorId: "HoneyBook", name: "HoneyBook", aliases: [], domains: ["honeybook.com"] },
  { competitorId: "Invoice Ninja", name: "Invoice Ninja", aliases: [], domains: [] },
  { competitorId: "Xero", name: "Xero", aliases: [], domains: ["xero.com"] },
  { competitorId: "Square", name: "Square", aliases: [], domains: ["squareup.com"] },
  { competitorId: "Harvest", name: "Harvest", aliases: [], domains: ["getharvest.com"] },
];

function show(a: Answer, entities: Entity[]) {
  const nameOf = (id: string | null) =>
    entities.find((e) => e.competitorId === id)?.name ?? "(removed competitor)";
  const found = detectMentions(a.text, entities);
  console.log(`\n${"═".repeat(78)}\n${a.label}`);

  // mark the first match of each found brand
  let marked = a.text;
  for (const m of [...found].sort((x, y) => y.index - x.index)) {
    const e = entities.find((x) => x.competitorId === m.competitorId)!;
    const len = [e.name, ...e.aliases, ...e.domains]
      .filter((t) => a.text.slice(m.index, m.index + t.length).toLowerCase() === t.toLowerCase())
      .reduce((l, t) => Math.max(l, t.length), 0);
    if (len)
      marked = `${marked.slice(0, m.index)}«${marked.slice(m.index, m.index + len)}»${marked.slice(m.index + len)}`;
  }
  console.log(
    `\n${FULL ? marked : marked.slice(0, 1500) + (marked.length > 1500 ? " […]" : "")}\n`,
  );

  if (!found.length) console.log("Found: nothing");
  for (const m of found) console.log(`  #${m.position} ${nameOf(m.competitorId)}  —  ${m.snippet}`);

  const foundIds = new Set(found.map((m) => m.competitorId));
  const misses = new Set<string>();
  for (const e of entities) {
    if (foundIds.has(e.competitorId)) continue;
    for (const t of [e.name, ...e.aliases])
      for (const m of a.text.matchAll(new RegExp(escape(t), "gi")))
        misses.add(
          `${e.name}: "…${a.text.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ")}…"`,
        );
  }
  for (const s of misses) console.log(`  not counted → ${s}`);

  if (a.stored) {
    const now = found.map((m) => nameOf(m.competitorId)).join(", ");
    const was = a.stored.join(", ");
    if (now !== was) console.log(`  stored differs: stored [${was}], now [${now}]`);
  }
}

function fixtures() {
  const files = readdirSync("scripts/fixtures").filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const d = JSON.parse(readFileSync(`scripts/fixtures/${f}`, "utf8"));
    for (const a of d.answers ?? [])
      if (a.text) show({ label: `${f} · ${d.prompt}`, text: a.text }, FIXTURE_BRANDS);
  }
}

async function database() {
  const { getDb, prepareDb } = await import("../db/client");
  const { answers, brands, mentions, competitors, runItems, runs, workspaces } =
    await import("../db/schema");
  const { loadEntities } = await import("../core/analysis");
  await prepareDb();
  const db = getDb();

  const name = flag("workspace");
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(name ? eq(workspaces.name, name) : undefined)
    .orderBy(asc(workspaces.createdAt))
    .limit(1);
  if (!ws) throw new Error(name ? `No workspace named "${name}".` : "No workspaces yet.");
  const [brand] = await db.select().from(brands).where(eq(brands.workspaceId, ws.id)).limit(1);
  if (!brand) throw new Error(`${ws.name} has no brand yet.`);
  const entities = (await loadEntities(db, [brand.id])).get(brand.id) ?? [];

  // random answers, each text once (fake and reused answers repeat)
  const pool = await db
    .select({
      id: answers.id,
      text: answers.text,
      prompt: runItems.promptText,
      engine: runItems.engine,
      country: runItems.country,
    })
    .from(answers)
    .innerJoin(runItems, eq(answers.runItemId, runItems.id))
    .innerJoin(runs, eq(runItems.runId, runs.id))
    .where(eq(runs.brandId, brand.id))
    .orderBy(sql`random()`)
    .limit(N * 20);
  const seen = new Set<string>();
  const picked = pool.filter((p) => !seen.has(p.text) && seen.add(p.text)).slice(0, N);

  const stored = picked.length
    ? await db
        .select({
          answerId: mentions.answerId,
          name: sql<string>`coalesce(${competitors.name}, ${brand.name})`,
        })
        .from(mentions)
        .leftJoin(competitors, eq(mentions.competitorId, competitors.id))
        .where(
          inArray(
            mentions.answerId,
            picked.map((p) => p.id),
          ),
        )
        .orderBy(asc(mentions.position))
    : [];

  console.log(
    `${ws.name}: ${picked.length} of ${pool.length >= N * 20 ? "many" : seen.size} different answers. Tracking ${entities.map((e) => e.name).join(", ")}.`,
  );
  for (const p of picked)
    show(
      {
        label: `${p.engine} · ${p.country ?? "–"} · "${p.prompt}"`,
        text: p.text,
        stored: stored.filter((s) => s.answerId === p.id).map((s) => s.name),
      },
      entities,
    );
}

(process.argv.includes("--fixtures") ? Promise.resolve(fixtures()) : database())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
