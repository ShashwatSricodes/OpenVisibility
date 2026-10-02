"use client";

import { useState, type ReactNode } from "react";
import { CircleCheck } from "./BrandMark";
import { Reveal } from "./Reveal";

/* illustrative per-call averages, search tool fees included.
   Real runs are metered from each Gateway response's reported cost. */
const PER_CALL = { accurate: 0.018, budget: 0.006 } as const;
const PARSE_PER_ANSWER = 0.0003;
const PLATFORM_FEE = 10;
const MARGIN = 0.07;

const ENGINES = ["ChatGPT", "Claude", "Gemini", "Perplexity", "Grok"];

const FREQ = [
  { id: "daily", label: "Daily", runs: 30 },
  { id: "weekly", label: "Weekly", runs: 4.33 },
  { id: "monthly", label: "Monthly", runs: 1 },
] as const;

type Preset = keyof typeof PER_CALL;
type FreqId = (typeof FREQ)[number]["id"];

const usd = (n: number) =>
  n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const SELF: ReactNode[] = [
  "The full tracking engine and dashboard",
  <>
    Bring your own keys: <b>Vercel AI Gateway</b>, OpenRouter or direct
  </>,
  "Scheduled runs, multi-sampling and archive",
  "CSV export of every answer",
  "Docker image, one-command setup",
];

const HOSTED: ReactNode[] = [
  <>
    API usage at provider cost <b>+ 7%</b>
  </>,
  "Managed keys, no provider accounts",
  "Prepaid wallet: tracking pauses at zero",
  "Budget caps and low-balance alerts",
  "Per-run cost breakdown",
  "Top up with Stripe, or Razorpay in INR",
];

const AGENCY: ReactNode[] = [
  "Everything in Hosted",
  "Team seats and many client brands",
  "White-label reports",
  "Google AI Overviews tracking",
  "GA4 and Search Console data",
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
  const [preset, setPreset] = useState<Preset>("accurate");

  const runs = FREQ.find((f) => f.id === freq)!.runs;
  const calls = Math.round(prompts * engines.length * samples * runs);
  const usage = calls * (PER_CALL[preset] + PARSE_PER_ANSWER);
  const hosted = engines.length ? PLATFORM_FEE + usage * (1 + MARGIN) : 0;

  const toggle = (e: string) =>
    setEngines((cur) =>
      cur.includes(e) ? cur.filter((x) => x !== e) : ENGINES.filter((x) => x === e || cur.includes(x)),
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
            <span className="t-small-strong" id="est-preset">
              Model preset
            </span>
            <div className="seg" role="radiogroup" aria-labelledby="est-preset">
              <button
                type="button"
                role="radio"
                aria-checked={preset === "accurate"}
                onClick={() => setPreset("accurate")}
              >
                Accurate
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={preset === "budget"}
                onClick={() => setPreset("budget")}
              >
                Budget
              </button>
            </div>
          </div>
        </div>
        <p className="t-small">
          {preset === "accurate"
            ? "Accurate matches each app’s default model."
            : "Budget uses cheaper models for directional data."}
        </p>
      </div>

      <div className="est-out" aria-live="polite">
        <div className="est-line">
          <span className="t-small">API calls / month</span>
          <span className="est-num">{calls.toLocaleString("en-US")}</span>
        </div>
        <div className="est-line">
          <span className="t-small">Self-hosted, paid to your provider</span>
          <span className="est-num">{usd(usage)}</span>
        </div>
        <div className="est-div" />
        <div className="est-total">
          <span className="t-small">Hosted, per month</span>
          <span className="amt">{usd(hosted)}</span>
          <span className="t-small">
            {usd(PLATFORM_FEE)} platform fee + {usd(usage * (1 + MARGIN))} usage
          </span>
        </div>
        <p className="est-fine">
          Illustrative averages, search fees included. Every real run is
          estimated first, then billed from the exact cost the provider reports.
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
            Pay for the calls you run{" "}
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
                <span className="per">+ your own API bill</span>
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
                <span className="pill">Popular</span>
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
              <p className="t-small plan-desc">
                For agencies reporting on many client brands.
              </p>
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
