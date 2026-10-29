import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Free AI visibility tools — OpenVisibility",
  description:
    "Check whether AI crawlers can read your pages, how ready a page is to be quoted, what ChatGPT searches for, how many prompts you need, and whether AI knows your brand. Free, no account.",
};

const TOOLS = [
  {
    href: "/tools/ai-crawler-check",
    title: "AI crawler check",
    body: "Can GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot and Googlebot read a page? Your robots.txt, noindex, and text hidden behind JavaScript.",
  },
  {
    href: "/tools/content-check",
    title: "AI content check",
    body: "How ready a page is to be quoted in an AI answer, out of 100, with the fixes that matter most.",
  },
  {
    href: "/tools/query-fan-out",
    title: "ChatGPT query fan-out",
    body: "Ask ChatGPT a question and see the web searches it runs to answer, and the sources it cites.",
  },
  {
    href: "/tools/prompt-calculator",
    title: "Prompt calculator",
    body: "How many prompts, and how many askings of each, give a mention rate you can trust, and what that costs.",
  },
  {
    href: "/tools/brand-entity-check",
    title: "Brand entity check",
    body: "Does AI know your brand as a company? Wikipedia, Wikidata, Organization markup and linked profiles.",
  },
];

export default function ToolsPage() {
  return (
    <>
      <Nav />
      <main className="page">
        <section className="wrap sec">
          <div className="sec-head">
            <span className="eyebrow">Free tools</span>
            <h1 className="t-h2">
              Free AI visibility tools <span className="dim">no account, no catch.</span>
            </h1>
          </div>
          <div className="tools-grid">
            {TOOLS.map((t) => (
              <Link key={t.href} href={t.href} className="tool-card">
                <h2 className="t-h3">{t.title}</h2>
                <p className="t-body">{t.body}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
