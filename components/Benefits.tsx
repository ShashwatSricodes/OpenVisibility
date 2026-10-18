import type { ReactNode } from "react";
import { Reveal } from "./Reveal";

const ITEMS: Array<{ title: string; body: ReactNode; icon: ReactNode }> = [
  {
    title: "Mention rate & position",
    body: "How often each engine names you across repeated samples, and where you land in its list when it does.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 19.5h16M7 16V11M12 16V6M17 16v-3"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "Share of voice",
    body: "Your mentions against every competitor you track, per engine and per country, with sentiment on each answer.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M12 3.5V12l6 6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "Owned vs third-party citations",
    body: "Which sources the models lean on, split into your own pages and everyone else’s, so you know where to publish.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    title: "Country-level tracking",
    body: "Pass a user location where the provider supports it, so an answer for Mumbai isn’t mistaken for one for Manchester.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="M3.5 12h17M12 3.5c2.3 2.5 3.5 5.4 3.5 8.5s-1.2 6-3.5 8.5c-2.3-2.5-3.5-5.4-3.5-8.5s1.2-6 3.5-8.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
        />
      </svg>
    ),
  },
  {
    title: "Answer archive & CSV",
    body: "Every answer is stored with its model, sample, country and cost. Read the original text, or export it all.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect
          x="3.5"
          y="4.5"
          width="17"
          height="4.5"
          rx="1.2"
          stroke="currentColor"
          strokeWidth="1.4"
        />
        <path
          d="M5 9v9.5h14V9M10 13h4"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "Budget caps & alerts",
    body: "Set a monthly cap and a low-balance threshold. Tracking pauses instead of overspending, and you hear about it first.",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M12 3.5 21 19.5H3L12 3.5Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path
          d="M12 10v4M12 16.8v.1"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
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
            The insights that matter <span className="dim">without the enterprise price tag.</span>
          </h2>
        </Reveal>
      </div>

      <div className="bn">
        {ITEMS.map((it, i) => (
          <Reveal key={it.title} delay={0.06 * i} className="bn-card" as="article">
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
