"use client";

import { useEffect, useState, useTransition } from "react";
import { answersFor, costOf, marginOf } from "@/core/tools/calculator";
import {
  checkContent,
  checkCrawlability,
  checkEntity,
  pollQueryFanOut,
  startQueryFanOut,
} from "./actions";

type Awaited2<T> = T extends Promise<infer U> ? U : T;

function Problem({ message }: { message: string }) {
  return (
    <div className="tool-out" role="alert">
      <p className="tool-bad">{message}</p>
    </div>
  );
}

/* ── AI crawler check ─────────────────────────────────────── */

const PURPOSE = {
  search: "Finds pages for answers",
  user: "Opens pages mid-answer",
  training: "Trains models",
};

export function CrawlabilityTool() {
  const [url, setUrl] = useState("");
  const [pending, start] = useTransition();
  const [r, setR] = useState<Awaited2<ReturnType<typeof checkCrawlability>> | null>(null);
  return (
    <>
      <form
        className="tool-form"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => setR(await checkCrawlability(url)));
        }}
      >
        <label className="tool-field">
          Page to check
          <input
            className="tool-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="yoursite.com/pricing"
            required
          />
        </label>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Checking…" : "Check"}
        </button>
      </form>
      {r && !r.ok && <Problem message={r.message} />}
      {r?.ok && (
        <div className="tool-out">
          <p className={r.issues.some((i) => i.severity === "problem") ? "tool-bad" : "tool-ok"}>
            {r.issues.some((i) => i.severity === "problem")
              ? "AI engines may not be able to use this page."
              : "AI engines can read this page."}{" "}
            <span className="tool-muted">
              HTTP {r.status} · {(r.ms / 1000).toFixed(1)}s · {r.words ?? 0} words without
              JavaScript ·{" "}
              {r.robots === "missing"
                ? "no robots.txt"
                : r.robots === "unreachable"
                  ? "robots.txt unreachable"
                  : "robots.txt found"}{" "}
              · {r.llmsTxt ? "llms.txt found" : "no llms.txt (optional)"}
            </span>
          </p>
          {r.issues.length > 0 && (
            <ul className="tool-list">
              {r.issues.map((i) => (
                <li
                  key={i.code}
                  className={
                    i.severity === "problem"
                      ? "tool-bad"
                      : i.severity === "warning"
                        ? "tool-warn"
                        : "tool-muted"
                  }
                >
                  {i.text}
                </li>
              ))}
            </ul>
          )}
          <div className="tool-scroll">
            <table className="tool-table">
              <thead>
                <tr>
                  <th>Crawler</th>
                  <th>What it does</th>
                  <th>This page</th>
                </tr>
              </thead>
              <tbody>
                {r.crawlers.map((c) => (
                  <tr key={c.agent}>
                    <td>
                      {c.agent} <span className="tool-muted">· {c.owner}</span>
                    </td>
                    <td className="tool-muted">{PURPOSE[c.purpose]}</td>
                    <td
                      className={
                        c.allowed ? "tool-ok" : c.purpose === "training" ? "tool-warn" : "tool-bad"
                      }
                    >
                      {c.allowed
                        ? "Allowed"
                        : `Blocked${c.rule ? ` (Disallow: ${c.rule.path})` : ""}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="tool-muted">
            Blocking a training crawler (GPTBot, ClaudeBot, CCBot…) doesn&rsquo;t keep you out of
            answers; blocking a search or user crawler does.
          </p>
        </div>
      )}
    </>
  );
}

/* ── content check ────────────────────────────────────────── */

export function ContentTool() {
  const [url, setUrl] = useState("");
  const [brand, setBrand] = useState("");
  const [pending, start] = useTransition();
  const [r, setR] = useState<Awaited2<ReturnType<typeof checkContent>> | null>(null);
  return (
    <>
      <form
        className="tool-form"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => setR(await checkContent(url, brand)));
        }}
      >
        <label className="tool-field">
          Page to check
          <input
            className="tool-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="yoursite.com/blog/post"
            required
          />
        </label>
        <label className="tool-field" style={{ flex: "0 1 200px" }}>
          Your brand (optional)
          <input
            className="tool-input"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Ledgerly"
          />
        </label>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Reading…" : "Check"}
        </button>
      </form>
      {r && !r.ok && <Problem message={r.message} />}
      {r?.ok && (
        <div className="tool-out">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              className={`tool-score ${r.score >= 70 ? "tool-ok" : r.score >= 40 ? "tool-warn" : "tool-bad"}`}
            >
              {r.score}
            </span>
            <span className="tool-muted">
              / 100, how ready the page is to be quoted in an AI answer. A checklist, not a
              prediction.
            </span>
          </div>
          {r.fixes.length > 0 && (
            <>
              <h3>What to fix, biggest first</h3>
              <ul className="tool-list">
                {r.fixes.map((f) => (
                  <li key={f.id}>{f.fix}</li>
                ))}
              </ul>
            </>
          )}
          <h3>The checks</h3>
          <table className="tool-table">
            <tbody>
              {r.checks.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td
                    className={
                      c.points === c.weight ? "tool-ok" : c.points > 0 ? "tool-warn" : "tool-bad"
                    }
                    style={{ textAlign: "right" }}
                  >
                    {c.points}/{c.weight}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tool-muted">
            {r.facts.words.toLocaleString("en-US")} words · {r.facts.questionHeadings} question
            headings · {r.facts.lists} lists · {r.facts.tables} tables · structured data:{" "}
            {r.facts.schema.join(", ") || "none"}
          </p>
        </div>
      )}
    </>
  );
}

/* ── query fan-out ────────────────────────────────────────── */

type FanOut = Awaited2<ReturnType<typeof pollQueryFanOut>>;

export function FanOutTool() {
  const [prompt, setPrompt] = useState("");
  const [country, setCountry] = useState("US");
  const [pending, start] = useTransition();
  const [id, setId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [r, setR] = useState<FanOut | null>(null);
  const [waited, setWaited] = useState(0);

  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = async () => {
      const got = await pollQueryFanOut(id);
      if (stop) return;
      setR(got);
      if (got.status === "running") {
        setWaited((w) => w + 5);
        setTimeout(tick, 5_000);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id]);

  const running = !!id && (!r || r.status === "running");
  return (
    <>
      <form
        className="tool-form"
        onSubmit={(e) => {
          e.preventDefault();
          setR(null);
          setMessage(null);
          setWaited(0);
          start(async () => {
            const s = await startQueryFanOut(prompt, country);
            if (s.ok) setId(s.id);
            else setMessage(s.message);
          });
        }}
      >
        <label className="tool-field">
          A question your buyers ask ChatGPT
          <input
            className="tool-input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What's the best invoicing app for freelancers?"
            required
          />
        </label>
        <label className="tool-field" style={{ flex: "0 1 110px" }}>
          Country
          <select
            className="tool-input"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            {["US", "GB", "IN", "CA", "AU", "DE", "FR", "ES", "IT", "NL", "SG"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" disabled={pending || running}>
          {pending || running ? "Asking…" : "Ask ChatGPT"}
        </button>
      </form>
      {message && <Problem message={message} />}
      {running && (
        <div className="tool-out">
          <p className="tool-muted">
            Asking ChatGPT as a logged-out visitor… this takes a minute or two
            {waited ? ` (${waited}s so far)` : ""}.
          </p>
        </div>
      )}
      {r?.status === "failed" && <Problem message={r.message} />}
      {r?.status === "done" && (
        <div className="tool-out">
          <h3>What ChatGPT searched for</h3>
          {r.result.searches.length ? (
            <ul className="tool-list">
              {r.result.searches.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <p className="tool-muted">
              {r.result.searched === false
                ? "ChatGPT answered from memory, without searching the web."
                : "ChatGPT didn't report its searches for this one."}
            </p>
          )}
          <p className="tool-muted">
            These are the searches your pages have to show up for to be found and quoted for this
            question.
          </p>
          {r.result.sources.length > 0 && (
            <>
              <h3>Sources it cited</h3>
              <ul className="tool-list">
                {r.result.sources.map((s) => (
                  <li key={s.url}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ textDecoration: "underline" }}
                    >
                      {s.title || s.domain}
                    </a>{" "}
                    <span className="tool-muted">· {s.domain}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          <details>
            <summary className="tool-muted" style={{ cursor: "pointer" }}>
              The start of the answer
            </summary>
            <p style={{ marginTop: 8 }}>{r.result.excerpt}…</p>
          </details>
        </div>
      )}
    </>
  );
}

/* ── prompt calculator ────────────────────────────────────── */

export function CalculatorTool() {
  const [prompts, setPrompts] = useState(20);
  const [engines, setEngines] = useState(4);
  const [countries, setCountries] = useState(1);
  const [samples, setSamples] = useState(3);
  const [runs, setRuns] = useState(4);
  const [margin, setMargin] = useState(5);
  const c = costOf({ prompts, engines, countries, samples, runsPerMonth: runs });
  const need = answersFor(margin / 100);
  const enough = c.answersPerEngine >= need;
  const num = (label: string, v: number, set: (n: number) => void, min: number, max: number) => (
    <label className="tool-field" style={{ flex: "1 1 140px" }}>
      {label}
      <input
        className="tool-input"
        type="number"
        min={min}
        max={max}
        value={v}
        onChange={(e) =>
          set(Math.max(min, Math.min(max, Math.round(Number(e.target.value) || min))))
        }
      />
    </label>
  );
  return (
    <>
      <div className="tool-form">
        {num("Prompts", prompts, setPrompts, 1, 1000)}
        {num("AI engines", engines, setEngines, 1, 8)}
        {num("Countries", countries, setCountries, 1, 30)}
        {num("Times each prompt is asked", samples, setSamples, 1, 10)}
        {num("Runs a month", runs, setRuns, 1, 31)}
        {num("Margin of error you accept (± points)", margin, setMargin, 1, 25)}
      </div>
      <div className="tool-out">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 32 }}>
          <div>
            <div className="tool-score">{c.perMonth.toLocaleString("en-US")}</div>
            <div className="tool-muted">
              answers a month ({c.perRun.toLocaleString("en-US")} a run)
            </div>
          </div>
          <div>
            <div className="tool-score">{c.withinFreeTier ? "$0" : `$${c.usd.toFixed(2)}`}</div>
            <div className="tool-muted">
              a month in Bright Data answers
              {c.withinFreeTier ? ", within its free 5,000" : " after the free 5,000"}
            </div>
          </div>
          <div>
            <div className={`tool-score ${enough ? "tool-ok" : "tool-warn"}`}>
              ±{Math.round(marginOf(c.answersPerEngine) * 100)}
            </div>
            <div className="tool-muted">points on each engine&rsquo;s monthly mention rate</div>
          </div>
        </div>
        <p>
          {enough
            ? `Each engine's monthly mention rate rests on ${c.answersPerEngine.toLocaleString("en-US")} answers: within ±${margin} points, 95% of the time.`
            : `For ±${margin} points you need about ${need.toLocaleString("en-US")} answers per engine a month; this plan gives ${c.answersPerEngine.toLocaleString("en-US")}. Add prompts, samples or runs, or accept a wider margin.`}
        </p>
        <p className="tool-muted">
          One prompt&rsquo;s own rate rests on far fewer answers (
          {(countries * samples * runs).toLocaleString("en-US")} a month per engine here, ±
          {Math.round(marginOf(countries * samples * runs) * 100)} points), so read single prompts
          as direction, not precision. AI answers vary from one asking to the next; asking each
          prompt a few times per run is what makes the numbers steady.
        </p>
      </div>
    </>
  );
}

/* ── brand entity check ───────────────────────────────────── */

export function EntityTool() {
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [pending, start] = useTransition();
  const [r, setR] = useState<Awaited2<ReturnType<typeof checkEntity>> | null>(null);
  return (
    <>
      <form
        className="tool-form"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => setR(await checkEntity(name, domain)));
        }}
      >
        <label className="tool-field">
          Brand
          <input
            className="tool-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ledgerly"
            required
          />
        </label>
        <label className="tool-field">
          Website
          <input
            className="tool-input"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
            placeholder="ledgerly.app"
            required
          />
        </label>
        <button className="btn btn-primary" disabled={pending}>
          {pending ? "Checking…" : "Check"}
        </button>
      </form>
      {r && !r.ok && <Problem message={r.message} />}
      {r?.ok && (
        <div className="tool-out">
          <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
            <span
              className={`tool-score ${r.score >= 4 ? "tool-ok" : r.score >= 2 ? "tool-warn" : "tool-bad"}`}
            >
              {r.score}/{r.of}
            </span>
            <span className="tool-muted">
              signals that tell AI “{r.brand}” is a company, and which one.
            </span>
          </div>
          <table className="tool-table">
            <tbody>
              {r.checks.map((c) => (
                <tr key={c.id}>
                  <td className={c.ok ? "tool-ok" : "tool-bad"} style={{ width: 24 }}>
                    {c.ok ? "✓" : "✗"}
                  </td>
                  <td>
                    <strong>{c.label}</strong>
                    <div className="tool-muted">{c.detail}</div>
                    {c.fix && <div>{c.fix}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
