import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

/* 24px line icons, drawn on one stroke */
const ico = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d={d}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const ITEMS: Array<{ title: string; body: ReactNode; icon: ReactNode }> = [
  {
    title: "Mention rate & share of voice",
    body: "How often each engine names you across repeated answers, where you land, and how you compare with every competitor, per country.",
    icon: ico("M4 19.5h16M7 16V11M12 16V6M17 16v-3"),
  },
  {
    title: "Citations, owned and third-party",
    body: "The pages AI answers lean on, split into yours and everyone else’s, so you know where to publish and who to talk to.",
    icon: ico(
      "M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1",
    ),
  },
  {
    title: "Site audit",
    body: "Which AI crawlers your robots.txt lets in, pages that need JavaScript to show any text, and a content score for each page with the fixes that raise it.",
    icon: ico("M4 5.5h16v13H4zM4 9h16M8 13l2 2 4-4"),
  },
  {
    title: "Recommendations & briefs",
    body: "One ranked list of what to do next: fixes, the prompts where competitors win and you don’t, and a content brief for each gap.",
    icon: ico("M5 6.5h14M5 12h10M5 17.5h6M17 15l2 2 3-3.5"),
  },
  {
    title: "An outreach agent",
    body: "Finds the pages AI cites and Google ranks top 5 for your prompts, drafts a pitch for each, and sends only what you approve, from your own mailbox. Replies and wins are tracked.",
    icon: ico("M3.5 6.5h17v11h-17zM3.5 7l8.5 6 8.5-6"),
  },
  {
    title: "Google results",
    body: "The top results for each prompt, checked weekly, so you can see which pages feed the AI answers and which of them to get onto.",
    icon: ico("M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.3 15.3 20 20"),
  },
  {
    title: "AI traffic",
    body: "Visits from GPTBot, ClaudeBot, PerplexityBot and 18 more, checked against each company’s published IP ranges, plus the people who click through from AI answers.",
    icon: ico("M3.5 17.5 9 12l3.5 3.5L20.5 7.5M15 7.5h5.5V13"),
  },
  {
    title: "An MCP server",
    body: "Ask Claude, Cursor or any MCP client about your visibility, competitors and citations, and start runs from the chat. 24 tools, read-only keys by default.",
    icon: ico("M8 8 4 12l4 4M16 8l4 4-4 4M13.5 5.5l-3 13"),
  },
  {
    title: "Archive, CSV & PDF",
    body: "Every answer stored with its engine, country and cost. Filter by date, engine or country, export it, or print a report for a client.",
    icon: ico("M3.5 4.5h17V9h-17zM5 9v9.5h14V9M10 13h4"),
  },
];

export function Benefits() {
  return (
    <section className="wrap sec" id="benefits">
      <div className="sec-head bn-head">
        <Reveal>
          <span className="eyebrow">What you get</span>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="t-h2">
            From what AI says to getting cited{" "}
            <span className="dim">without the enterprise price tag.</span>
          </h2>
        </Reveal>
      </div>

      <div className="bn">
        {ITEMS.map((it, i) => (
          <Reveal key={it.title} delay={0.05 * i} className="bn-card" as="article">
            <span className="bn-ico" aria-hidden="true">
              {it.icon}
            </span>
            <div className="bn-txt">
              <h3 className="t-strong">{it.title}</h3>
              <p className="t-body">{it.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
