import type { ReactNode } from "react";
import { Plus } from "./BrandMark";
import { Reveal } from "./Reveal";

const QA: Array<{ q: string; a: ReactNode; open?: boolean }> = [
  {
    q: "How is this different from Profound and other AI visibility tools?",
    open: true,
    a: (
      <>
        It&rsquo;s open source, and you pay for usage instead of a contract. The architecture is
        built to be cheap: bring your own keys, smart sampling, cheap models for parsing answers,
        and caching. It&rsquo;s aimed at small businesses, freelancers, agencies and emerging
        markets.
      </>
    ),
  },
  {
    q: "Do API answers match what people see in the ChatGPT app?",
    a: (
      <>
        Not exactly, and we won&rsquo;t pretend otherwise. We query the models through their APIs
        with web search on, so we measure how the models respond. The consumer apps add their own
        layers on top. Treat the results as a strong signal, not a screenshot.
      </>
    ),
  },
  {
    q: "Do you scrape ChatGPT or Perplexity?",
    a: (
      <>
        No. Everything goes through official APIs, which keeps tracking within each provider&rsquo;s
        terms, stable from week to week, and predictable in cost.
      </>
    ),
  },
  {
    q: "What does a run actually cost?",
    a: (
      <>
        You see an estimate before every run. Afterwards, each response&rsquo;s exact cost is stored
        against the run, so you get a per-engine breakdown. On hosted, you top up a wallet and
        tracking pauses when it runs out, so there&rsquo;s never a surprise invoice.
      </>
    ),
  },
  {
    q: "Can I self-host with my own API keys?",
    a: (
      <>
        Yes. Run the Docker image and plug in a Vercel AI Gateway key, an OpenRouter key, or keys
        for each provider directly. The tracking engine, metrics, dashboard, scheduling and exports
        are all AGPL-3.0.
      </>
    ),
  },
  {
    q: "Do you track Google AI Overviews?",
    a: (
      <>
        Not yet. AI Overviews has no official API, so it&rsquo;s planned for version 2 through a
        SERP data provider, alongside GA4 and Search Console integration.
      </>
    ),
  },
];

/* template lays the six rows out as two columns of three */
const LEFT = QA.slice(0, 3);
const RIGHT = QA.slice(3);

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
