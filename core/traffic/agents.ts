/**
 * Who's who in AI traffic: the crawlers and agents that fetch pages for AI
 * companies, and the assistants people click through from.
 *
 * Crawlers are recognised by their user agent, then checked against the IP
 * ranges their company publishes (core/traffic/verify.ts): user agents are
 * easy to fake, published ranges aren't. Lists checked 29 October 2026; all
 * use the same JSON format ({ prefixes: [{ ipv4Prefix | ipv6Prefix }] }).
 */

export type Purpose = "search" | "user" | "training";

export type Agent = {
  name: string;
  owner: string;
  purpose: Purpose;
  /** matched against the user agent, case-insensitively */
  pattern: RegExp;
  /** the company's published IP ranges; none: can't be verified */
  ranges?: string[];
};

const OPENAI = "https://openai.com";
const GOOGLE = "https://developers.google.com/static/search/apis/ipranges";

/** Most specific first: "ChatGPT-User" before anything looser. */
export const AGENTS: Agent[] = [
  {
    name: "OAI-SearchBot",
    owner: "OpenAI",
    purpose: "search",
    pattern: /OAI-SearchBot/i,
    ranges: [`${OPENAI}/searchbot.json`],
  },
  {
    name: "ChatGPT-User",
    owner: "OpenAI",
    purpose: "user",
    pattern: /ChatGPT-User/i,
    ranges: [`${OPENAI}/chatgpt-user.json`],
  },
  {
    name: "GPTBot",
    owner: "OpenAI",
    purpose: "training",
    pattern: /GPTBot/i,
    ranges: [`${OPENAI}/gptbot.json`],
  },
  {
    name: "PerplexityBot",
    owner: "Perplexity",
    purpose: "search",
    pattern: /PerplexityBot/i,
    ranges: ["https://www.perplexity.com/perplexitybot.json"],
  },
  {
    name: "Perplexity-User",
    owner: "Perplexity",
    purpose: "user",
    pattern: /Perplexity-User/i,
    ranges: ["https://www.perplexity.com/perplexity-user.json"],
  },
  {
    name: "Claude-SearchBot",
    owner: "Anthropic",
    purpose: "search",
    pattern: /Claude-SearchBot/i,
    ranges: ["https://claude.com/crawling/bots.json"],
  },
  {
    name: "Claude-User",
    owner: "Anthropic",
    purpose: "user",
    pattern: /Claude-User/i,
    ranges: ["https://claude.com/crawling/bots.json"],
  },
  {
    name: "ClaudeBot",
    owner: "Anthropic",
    purpose: "training",
    pattern: /ClaudeBot/i,
    ranges: ["https://claude.com/crawling/bots.json"],
  },
  {
    name: "Google-CloudVertexBot",
    owner: "Google",
    purpose: "user",
    pattern: /Google-CloudVertexBot/i,
    ranges: [`${GOOGLE}/special-crawlers.json`],
  },
  {
    name: "Googlebot",
    owner: "Google",
    purpose: "search",
    pattern: /Googlebot/i,
    ranges: [`${GOOGLE}/googlebot.json`],
  },
  {
    name: "Bingbot",
    owner: "Microsoft",
    purpose: "search",
    pattern: /bingbot/i,
    ranges: ["https://www.bing.com/toolbox/bingbot.json"],
  },
  {
    name: "Applebot",
    owner: "Apple",
    purpose: "search",
    pattern: /Applebot/i,
    ranges: ["https://search.developer.apple.com/applebot.json"],
  },
  { name: "DuckAssistBot", owner: "DuckDuckGo", purpose: "user", pattern: /DuckAssistBot/i },
  { name: "MistralAI-User", owner: "Mistral", purpose: "user", pattern: /MistralAI-User/i },
  {
    name: "Meta-ExternalFetcher",
    owner: "Meta",
    purpose: "user",
    pattern: /meta-externalfetcher/i,
  },
  {
    name: "Meta-ExternalAgent",
    owner: "Meta",
    purpose: "training",
    pattern: /meta-externalagent/i,
  },
  { name: "Amazonbot", owner: "Amazon", purpose: "search", pattern: /Amazonbot/i },
  { name: "Bytespider", owner: "ByteDance", purpose: "training", pattern: /Bytespider/i },
  { name: "CCBot", owner: "Common Crawl", purpose: "training", pattern: /CCBot/i },
  {
    name: "cohere-ai",
    owner: "Cohere",
    purpose: "training",
    pattern: /cohere-ai|cohere-training-data-crawler/i,
  },
  { name: "YouBot", owner: "You.com", purpose: "search", pattern: /YouBot/i },
];

export const agentOf = (userAgent: string) => AGENTS.find((a) => a.pattern.test(userAgent)) ?? null;
export const agentNamed = (name: string) => AGENTS.find((a) => a.name === name) ?? null;

/** Assistants whose links bring people to a site, by referring host. */
export const ASSISTANTS: { name: string; hosts: string[] }[] = [
  { name: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com"] },
  { name: "Perplexity", hosts: ["perplexity.ai"] },
  { name: "Gemini", hosts: ["gemini.google.com", "bard.google.com"] },
  { name: "Copilot", hosts: ["copilot.microsoft.com", "copilot.cloud.microsoft"] },
  { name: "Claude", hosts: ["claude.ai"] },
  { name: "DeepSeek", hosts: ["chat.deepseek.com"] },
  { name: "Grok", hosts: ["grok.com"] },
  { name: "Meta AI", hosts: ["meta.ai"] },
  { name: "Mistral", hosts: ["chat.mistral.ai"] },
  { name: "You.com", hosts: ["you.com"] },
  { name: "Phind", hosts: ["phind.com"] },
];

/**
 * The assistant a visit came from: the Referer's host, or the utm_source
 * ChatGPT and others add to links ("?utm_source=chatgpt.com").
 */
export function assistantOf(referer: string | null | undefined, path: string): string | null {
  const hosts: string[] = [];
  try {
    if (referer) hosts.push(new URL(referer).hostname.replace(/^www\./, ""));
  } catch {
    // not a URL
  }
  const utm = /[?&]utm_source=([^&#]+)/i.exec(path)?.[1];
  if (utm)
    hosts.push(
      decodeURIComponent(utm)
        .toLowerCase()
        .replace(/^www\./, ""),
    );
  for (const h of hosts) {
    const hit = ASSISTANTS.find((a) => a.hosts.some((x) => h === x || h.endsWith(`.${x}`)));
    if (hit) return hit.name;
  }
  return null;
}

/**
 * The filter a site snippet uses to decide what to report, as a regular
 * expression source: the AI agents' user agents. Search engines' general
 * crawlers (Googlebot, Bingbot, Applebot) are left out: they crawl all the
 * time and aren't AI-specific, so live reporting would flood the endpoint;
 * uploaded logs still count them. Kept in one place so the snippets and the
 * server agree.
 */
export const NOT_LIVE = ["Googlebot", "Bingbot", "Applebot"];
export const SNIPPET_AGENTS = AGENTS.filter((a) => !NOT_LIVE.includes(a.name))
  .map((a) => a.pattern.source)
  .join("|");
export const SNIPPET_REFERRERS = [...ASSISTANTS.flatMap((a) => a.hosts), "utm_source="]
  .map((h) => h.replace(/[.]/g, "\\."))
  .join("|");
