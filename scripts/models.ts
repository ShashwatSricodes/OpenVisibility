/**
 * Lists the Gateway's language models for the five tracked engines,
 * with token and web-search prices. The model list is public, so this
 * needs no API key.
 *
 *   npm run models            # search-capable models only
 *   npm run models -- --all   # every model for the five engines
 */

const OWNERS: Record<string, string> = {
  openai: "ChatGPT",
  anthropic: "Claude",
  google: "Gemini",
  perplexity: "Perplexity",
  spacexai: "Grok",
};

type Model = {
  id: string;
  type: string;
  tags?: string[];
  context_window?: number;
  zdr?: string;
  pricing?: { input?: string; output?: string; web_search?: string };
};

const perMillion = (v?: string) => (v === undefined ? "-" : `$${(Number(v) * 1e6).toFixed(2)}`);

async function main() {
  const all = process.argv.includes("--all");
  const res = await fetch("https://ai-gateway.vercel.sh/v1/models");
  if (!res.ok) throw new Error(`Model list request failed: ${res.status}`);
  const { data } = (await res.json()) as { data: Model[] };

  const rows = data
    .filter((m) => m.type === "language" && m.id.split("/")[0] in OWNERS)
    .filter((m) => all || m.tags?.includes("web-search"))
    .sort((a, b) => a.id.localeCompare(b.id));

  let engine = "";
  for (const m of rows) {
    const owner = OWNERS[m.id.split("/")[0]];
    if (owner !== engine) {
      engine = owner;
      console.log(`\n${engine}`);
    }
    const p = m.pricing ?? {};
    console.log(
      "  " +
        m.id.padEnd(40) +
        `in ${perMillion(p.input).padStart(7)}/M  ` +
        `out ${perMillion(p.output).padStart(7)}/M  ` +
        `search ${p.web_search ? `$${p.web_search}/1k` : "-"}`.padEnd(16) +
        (m.zdr === "none" ? "  no ZDR" : ""),
    );
  }
  console.log(`\n${rows.length} models`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
