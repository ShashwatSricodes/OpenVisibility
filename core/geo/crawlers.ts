/**
 * The crawlers that decide whether AI answers can use a page, and what
 * blocking each one costs. Checked 20 October 2026 against each company's
 * crawler documentation; user-agent names change, so keep this list current.
 *
 * - search: indexes pages so the assistant can find and cite them. Blocking
 *   it keeps you out of that engine's answers.
 * - user: fetches a page when someone asks the assistant to read it. Blocking
 *   it means the assistant can't open your link mid-conversation.
 * - training: collects pages to train models. Blocking it doesn't remove you
 *   from answers today; whether to allow it is a business choice.
 */

import type { EngineId } from "../providers/types";

export type CrawlerPurpose = "search" | "user" | "training";

export type Crawler = {
  /** the robots.txt user-agent token */
  agent: string;
  owner: string;
  purpose: CrawlerPurpose;
  /** the engines whose answers depend on it */
  engines: EngineId[];
  note: string;
};

export const CRAWLERS: Crawler[] = [
  {
    agent: "OAI-SearchBot",
    owner: "OpenAI",
    purpose: "search",
    engines: ["chatgpt"],
    note: "Finds pages for ChatGPT search and its cited sources.",
  },
  {
    agent: "ChatGPT-User",
    owner: "OpenAI",
    purpose: "user",
    engines: ["chatgpt"],
    note: "Opens a page when someone asks ChatGPT to read it.",
  },
  {
    agent: "GPTBot",
    owner: "OpenAI",
    purpose: "training",
    engines: [],
    note: "Collects pages to train OpenAI's models.",
  },
  {
    agent: "Googlebot",
    owner: "Google",
    purpose: "search",
    engines: ["ai_overviews", "ai_mode"],
    note: "Google Search's crawler; AI Overviews and AI Mode use its index.",
  },
  {
    agent: "Google-Extended",
    owner: "Google",
    purpose: "training",
    engines: ["gemini"],
    note: "Not a separate crawler: a token that controls whether Gemini may train on, and ground answers in, your pages. AI Overviews follow Googlebot.",
  },
  {
    agent: "PerplexityBot",
    owner: "Perplexity",
    purpose: "search",
    engines: ["perplexity"],
    note: "Indexes pages for Perplexity's answers.",
  },
  {
    agent: "Perplexity-User",
    owner: "Perplexity",
    purpose: "user",
    engines: ["perplexity"],
    note: "Opens a page while answering a question.",
  },
  {
    agent: "Claude-SearchBot",
    owner: "Anthropic",
    purpose: "search",
    engines: ["claude"],
    note: "Indexes pages for Claude's web search.",
  },
  {
    agent: "Claude-User",
    owner: "Anthropic",
    purpose: "user",
    engines: ["claude"],
    note: "Opens a page when someone asks Claude to read it.",
  },
  {
    agent: "ClaudeBot",
    owner: "Anthropic",
    purpose: "training",
    engines: [],
    note: "Collects pages to train Anthropic's models.",
  },
  {
    agent: "Bingbot",
    owner: "Microsoft",
    purpose: "search",
    engines: ["copilot"],
    note: "Bing's crawler; Copilot answers from Bing's index.",
  },
  {
    agent: "Applebot-Extended",
    owner: "Apple",
    purpose: "training",
    engines: [],
    note: "Controls whether Apple trains its models on your pages.",
  },
  {
    agent: "CCBot",
    owner: "Common Crawl",
    purpose: "training",
    engines: [],
    note: "Builds the open web archive many models are trained on.",
  },
  {
    agent: "Meta-ExternalAgent",
    owner: "Meta",
    purpose: "training",
    engines: [],
    note: "Collects pages to train Meta's models.",
  },
];

/** Blocking these keeps a page out of answers; the rest are a choice. */
export const matters = (c: Pick<Crawler, "purpose">) => c.purpose !== "training";
