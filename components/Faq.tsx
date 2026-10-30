import type { ReactNode } from "react";
import { Plus } from "./BrandMark";
import { Reveal } from "./Reveal";

const QA: Array<{ q: string; a: ReactNode; open?: boolean }> = [
  {
    q: "How is this different from Profound and other AI visibility tools?",
    open: true,
    a: (
      <>
        It&rsquo;s open source, you pay per answer instead of a contract, and it goes past tracking:
        a site audit, a ranked list of fixes, content briefs and an outreach agent that gets you
        onto the pages AI cites. It&rsquo;s built for small businesses, freelancers, agencies and
        emerging markets.
      </>
    ),
  },
  {
    q: "Do your answers match what people see in ChatGPT?",
    a: (
      <>
        As closely as we can get. Answers come from the ChatGPT and Gemini apps and Google&rsquo;s
        AI results, logged out and from the country you choose, through Bright Data. Signed-in users
        get personalised answers, and every answer varies, so we ask each prompt several times and
        report a rate.
      </>
    ),
  },
  {
    q: "Which engines can you track?",
    a: (
      <>
        ChatGPT, Gemini, Google AI Mode and Google AI Overviews. Perplexity is in beta: it often
        turns requests away. Claude and Copilot need a signed-in account and Grok has no scraper
        yet, so we don&rsquo;t track them, rather than show you numbers we can&rsquo;t stand behind.
      </>
    ),
  },
  {
    q: "What does a run cost?",
    a: (
      <>
        Bright Data charges $0.0015 per answer, and the first 5,000 a month are free on your own
        account. Every run shows its answer count and cost before it starts, and a monthly limit
        stops tracking before it goes over.
      </>
    ),
  },
  {
    q: "Does the outreach agent email people on its own?",
    a: (
      <>
        No. It finds the pages worth getting onto and drafts each pitch; nothing is sent until you
        approve it, and then it goes from your own mailbox. It writes to each site at most once a
        quarter, keeps a do-not-contact list, and tracks replies and placements.
      </>
    ),
  },
  {
    q: "Can I use it from Claude or Cursor?",
    a: (
      <>
        Yes. Create a key in settings and add the MCP server to Claude, Cursor or any MCP client.
        Ask about mention rates, competitors, citations and recommendations, or start a run, from
        the chat. Keys are read-only unless you allow writes.
      </>
    ),
  },
  {
    q: "Can I self-host it?",
    a: (
      <>
        Yes, under AGPL-3.0. You need Postgres and a Bright Data key; an analysis model for
        sentiment, briefs and pitches is optional, and any OpenAI-compatible one works, including
        free tiers. A one-command Docker image is on the way.
      </>
    ),
  },
  {
    q: "Do you connect Google Analytics and Search Console?",
    a: (
      <>
        That&rsquo;s next. Today you can see AI crawler visits and clicks from AI answers by adding
        a small snippet to your site or uploading server logs, and every check on the free tools
        page works without an account.
      </>
    ),
  },
];

/* two columns of four */
const LEFT = QA.slice(0, 4);
const RIGHT = QA.slice(4);

function Col({ items, base }: { items: typeof QA; base: number }) {
  return (
    <div className="faq-col">
      {items.map((it, i) => (
        <Reveal key={it.q} delay={0.08 * (base + i)}>
          <details open={it.open}>
            <summary>
              <span>{it.q}</span>
              <Plus />
            </summary>
            <p className="ans t-small">{it.a}</p>
          </details>
        </Reveal>
      ))}
    </div>
  );
}

export function Faq() {
  return (
    <section className="wrap sec" id="faq">
      <div className="sec-head faq-head">
        <Reveal>
          <span className="eyebrow">FAQ</span>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="t-h2">
            Your questions, <span className="dim">answered straight</span>
          </h2>
        </Reveal>
      </div>

      <Reveal y={16} className="faq" delay={0.1}>
        <Col items={LEFT} base={0} />
        <Col items={RIGHT} base={1} />
      </Reveal>
    </section>
  );
}
