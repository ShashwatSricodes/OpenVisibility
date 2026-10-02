"use client";

import { useState } from "react";
import { Reveal } from "./Reveal";

const IMAGES = [
  "/tpl/k9rpWO1sLtG8iiQ3DPLipCWO4.jpg",
  "/tpl/gl1AmAer8Gqr1XoceJt3QJT1X8.jpg",
  "/tpl/Oa5XWzCxeOrnYG2m62cgAZq4LE.jpg",
  "/tpl/bEYHTLEMGSrPDYKasmCLGyydk.jpg",
];

const CASES = [
  {
    tab: "Small business",
    title: "Small businesses",
    body: "Find out whether AI recommends you when customers ask for the best option in your category, for a few dollars a month instead of an annual contract.",
  },
  {
    tab: "Agencies",
    title: "Agencies",
    body: "Track every client brand from one install. Per-run cost breakdowns make it easy to pass API spend through at cost.",
  },
  {
    tab: "Freelancers",
    title: "SEO & content freelancers",
    body: "Add AI visibility to your audits. Show clients their mention rate, the competitors beating them, and the pages AI cites instead.",
  },
  {
    tab: "Local markets",
    title: "India & emerging markets",
    body: "Track by country so answers reflect where your customers are. Top up in rupees with Razorpay, or in any currency with Stripe.",
  },
  {
    tab: "Self-hosters",
    title: "Self-hosters",
    body: "Run the whole stack with Docker and your own provider keys. Your prompts, answers and costs stay in your own Postgres.",
  },
  {
    tab: "Content teams",
    title: "Content teams",
    body: "See which third-party pages AI cites in your category, and which of your own pages it never picks up.",
  },
];

export function UseCases() {
  const [at, setAt] = useState(0);
  const c = CASES[at];

  return (
    <section className="wrap sec" id="features">
      <div className="sec-head uc-head">
        <Reveal>
          <span className="eyebrow">Who it&rsquo;s for</span>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="t-h2">
            Built for the teams enterprise tools priced out{" "}
            <span className="dim">and the people who work for them.</span>
          </h2>
        </Reveal>
      </div>

      <Reveal className="uc" delay={0.15}>
        <div className="tabs" role="tablist" aria-label="Use cases">
          {CASES.map((it, i) => (
            <button
              key={it.tab}
              type="button"
              role="tab"
              className="tab"
              aria-selected={i === at}
              aria-controls="uc-panel"
              onClick={() => setAt(i)}
            >
              {it.tab}
            </button>
          ))}
        </div>

        <div className="uc-body" id="uc-panel" role="tabpanel">
          <div className="uc-img" aria-hidden="true">
            {IMAGES.map((src, i) => (
              <img
                key={src}
                src={src}
                alt=""
                width={1032}
                height={800}
                loading="lazy"
                decoding="async"
                className={i === at % IMAGES.length ? "on" : ""}
              />
            ))}
          </div>

          <div className="uc-right">
            <div className="uc-copy">
              <span className="t-small">{c.title}</span>
              <p className="t-h3">{c.body}</p>
            </div>
            <a className="btn btn-primary" href="#pricing">
              Start tracking
            </a>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
