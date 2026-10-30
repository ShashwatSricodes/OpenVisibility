"use client";

import { useState, type ReactNode } from "react";
import { BRIGHT_DATA_PRICING } from "@/core/providers/registry";
import { CircleCheck } from "./BrandMark";
import { Reveal } from "./Reveal";

/* Bright Data's list price per answer, and the answers free each month */
const PER_ANSWER = BRIGHT_DATA_PRICING.perAnswerUsd;
const FREE = BRIGHT_DATA_PRICING.freeAnswersPerMonth;
const PLATFORM_FEE = 10;
const MARGIN = 0.07;

const ENGINES = ["ChatGPT", "Gemini", "Google AI Mode", "AI Overviews"];
const COUNTRIES = [1, 2, 3] as const;

const FREQ = [
  { id: "daily", label: "Daily", runs: 30 },
  { id: "weekly", label: "Weekly", runs: 4.33 },
  { id: "monthly", label: "Monthly", runs: 1 },
] as const;

type FreqId = (typeof FREQ)[number]["id"];

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const SELF: ReactNode[] = [
  "Tracking, dashboard, archive and exports",
  <>
    Your own <b>Bright Data</b> account: 5,000 answers a month free
  </>,
  "Site audit and recommendations",
  "Outreach agent, from your own mailbox",
  "AI traffic, Google results and MCP server",
];

const HOSTED: ReactNode[] = [
  <>
    Answers at Bright Data&rsquo;s price <b>+ 7%</b>
  </>,
  "Everything in Self-hosted",
  "No Bright Data account or server needed",
  "A monthly answer limit you set",
  "Every answer's cost on the run",
  "Pay by card, or UPI in India",
];

const AGENCY: ReactNode[] = [
  "Everything in Hosted",
  "Team seats and many client brands",
  "White-label reports",
  "GA4 and Search Console data",
  "A report link for each client",
];

function Included({ items, pad = 0 }: { items: ReactNode[]; pad?: number }) {
  return (
    <ul className="inc">
      {items.map((f, i) => (
        <li key={i} className="t-small">
          <CircleCheck />
          <span>{f}</span>
        </li>
      ))}
      {Array.from({ length: pad }).map((_, i) => (
        <li key={`s${i}`} className="spacer" aria-hidden="true" />
      ))}
    </ul>
  );
}

function Estimator() {
  const [prompts, setPrompts] = useState(25);
  const [samples, setSamples] = useState(3);
  const [engines, setEngines] = useState<string[]>(ENGINES.slice(0, 4));
  const [freq, setFreq] = useState<FreqId>("weekly");
  const [countries, setCountries] = useState<number>(1);

  const runs = FREQ.find((f) => f.id === freq)!.runs;
  const answers = Math.round(prompts * engines.length * countries * samples * runs);
  const self = Math.max(0, answers - FREE) * PER_ANSWER;
  const usage = answers * PER_ANSWER * (1 + MARGIN);
  const hosted = engines.length ? PLATFORM_FEE + usage : 0;

  const toggle = (e: string) =>
    setEngines((cur) =>
      cur.includes(e)
        ? cur.filter((x) => x !== e)
        : ENGINES.filter((x) => x === e || cur.includes(x)),
    );

  return (
    <div className="est">
      <div className="est-in">
        <div className="est-row">
          <label className="est-lbl" htmlFor="est-prompts">
            <span className="t-small-strong">Prompts</span>
            <span className="est-val">{prompts}</span>
          </label>
          <input
            id="est-prompts"
            type="range"
            min={5}
            max={200}
            step={5}
            value={prompts}
            onChange={(e) => setPrompts(Number(e.target.value))}
          />
        </div>

        <div className="est-row">
          <label className="est-lbl" htmlFor="est-samples">
            <span className="t-small-strong">Samples per prompt</span>
            <span className="est-val">{samples}×</span>
          </label>
          <input
            id="est-samples"
            type="range"
            min={1}
            max={10}
            value={samples}
            onChange={(e) => setSamples(Number(e.target.value))}
          />
        </div>

        <div className="est-row">
          <span className="t-small-strong" id="est-eng">
            Engines
          </span>
          <div className="chips" role="group" aria-labelledby="est-eng">
            {ENGINES.map((e) => (
              <button
                key={e}
                type="button"
                className="chip"
                aria-pressed={engines.includes(e)}
                onClick={() => toggle(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </div>

        <div className="est-pair">
          <div className="est-row">
            <span className="t-small-strong" id="est-freq">
              Schedule
            </span>
            <div className="seg" role="radiogroup" aria-labelledby="est-freq">
              {FREQ.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="radio"
                  aria-checked={freq === f.id}
                  onClick={() => setFreq(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <div className="est-row">
            <span className="t-small-strong" id="est-countries">
              Countries
            </span>
            <div className="seg" role="radiogroup" aria-labelledby="est-countries">
              {COUNTRIES.map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={countries === n}
                  onClick={() => setCountries(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="t-small">
          One answer is one prompt, asked once, on one engine, in one country.
        </p>
      </div>

      <div className="est-out" aria-live="polite">
        <div className="est-line">
          <span className="t-small">Answers / month</span>
          <span className="est-num">{answers.toLocaleString("en-US")}</span>
        </div>
        <div className="est-line">
          <span className="t-small">Self-hosted, paid to Bright Data</span>
          <span className="est-num">{self ? usd(self) : "Free"}</span>
        </div>
        <div className="est-div" />
        <div className="est-total">
          <span className="t-small">Hosted, per month</span>
          <span className="amt">{usd(hosted)}</span>
          <span className="t-small">
            {usd(PLATFORM_FEE)} platform fee + {usd(usage)} answers
          </span>
        </div>
        <p className="est-fine">
          At ${PER_ANSWER} an answer, with the first {FREE.toLocaleString("en-US")} a month free on
          your own Bright Data account. Every run shows its answers and cost before it starts.
        </p>
      </div>
    </div>
  );
}

export function Pricing() {
  return (
    <section className="wrap sec sec-pricing" id="pricing">
      <div className="sec-head pr-head">
        <Reveal>
          <span className="eyebrow">Pricing</span>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="t-h2">
            Pay for the answers you collect{" "}
            <span className="dim">and see the number before you run them.</span>
          </h2>
        </Reveal>
      </div>

      <div className="pr">
        <Reveal y={32} className="pr-est" delay={0.1}>
          <Estimator />
        </Reveal>

        <div className="plans">
          <Reveal y={32} className="plan" as="article" delay={0.15}>
            <div className="plan-head">
              <div className="plan-top">
                <span className="t-h3">Self-hosted</span>
              </div>
              <div className="price">
                <span className="amt">$0</span>
                <span className="per">+ Bright Data past 5,000 free</span>
              </div>
              <p className="t-small plan-desc">
                For developers and teams happy to run their own server.
              </p>
            </div>
            <a className="btn btn-text" href="https://github.com/ShashwatSricodes/OpenVisibility">
              View on GitHub
            </a>
            <div className="feat-div">
              <span className="t-small">Features</span>
            </div>
            <Included items={SELF} pad={1} />
          </Reveal>

          <Reveal y={32} className="plan pro" as="article" delay={0.22}>
            <div className="plan-head">
              <div className="plan-top">
                <span className="t-h3">Hosted</span>
                <span className="pill">Early access</span>
              </div>
              <div className="price">
                <span className="amt">$10</span>
                <span className="per">/month + usage</span>
              </div>
              <p className="t-small plan-desc">
                For businesses that want tracking without running servers.
              </p>
            </div>
            <a className="btn btn-primary" href="#final-cta">
              Start tracking
            </a>
            <div className="feat-div">
              <span className="t-small">Features</span>
            </div>
            <Included items={HOSTED} />
          </Reveal>

          <Reveal y={32} className="plan" as="article" delay={0.29}>
            <div className="plan-head">
              <div className="plan-top">
                <span className="t-h3">Agency</span>
                <span className="pill">Coming soon</span>
              </div>
              <div className="price">
                <span className="amt">Custom</span>
              </div>
              <p className="t-small plan-desc">For agencies reporting on many client brands.</p>
            </div>
            <a className="btn btn-text" href="#final-cta">
              Join the waitlist
            </a>
            <div className="feat-div">
              <span className="t-small">Features</span>
            </div>
            <Included items={AGENCY} pad={1} />
          </Reveal>
        </div>
      </div>
    </section>
  );
}
