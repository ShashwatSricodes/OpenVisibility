import { CircleCheck } from "./BrandMark";
import { Reveal } from "./Reveal";

const OPEN = [
  "Tracking engine, scheduler and multi-sampling",
  "Metrics, dashboard and answer archive",
  "CSV export",
  "Bring your own keys: Vercel AI Gateway, OpenRouter or direct",
  "Docker image with one-command setup",
];

const HOSTED = [
  "Managed keys, no provider accounts needed",
  "Prepaid wallet with Stripe or Razorpay",
  "Multi-tenant workspaces",
  "Team and agency features",
  "White-label reports (v2)",
];

export function OpenCore() {
  return (
    <section className="wrap sec" id="open-source">
      <div className="sec-head oc-head">
        <Reveal>
          <span className="eyebrow">Open core</span>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="t-h2">
            One codebase, two ways to run it{" "}
            <span className="dim">and the hosted one runs the same core.</span>
          </h2>
        </Reveal>
      </div>

      <div className="oc">
        <Reveal y={32} className="oc-card" as="article" delay={0.1}>
          <div className="oc-top">
            <span className="t-h3">Open source</span>
            <span className="pill">AGPL-3.0</span>
          </div>
          <p className="t-body">
            Everything you need to track AI visibility yourself. Read it, fork it, and run it on a
            cheap VPS.
          </p>
          <ul className="inc">
            {OPEN.map((f) => (
              <li key={f} className="t-small">
                <CircleCheck />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <pre className="oc-term" aria-label="Install commands">
            <code>
              <span className="c"># clone, add a key, start</span>
              {"\n"}git clone github.com/ShashwatSricodes/OpenVisibility
              {"\n"}cp .env.example .env <span className="c"># AI_GATEWAY_API_KEY=…</span>
              {"\n"}docker compose up -d
            </code>
          </pre>
        </Reveal>

        <Reveal y={32} className="oc-card alt" as="article" delay={0.18}>
          <div className="oc-top">
            <span className="t-h3">Hosted only</span>
            <span className="pill">/ee</span>
          </div>
          <p className="t-body">
            The parts that only make sense when we run it for you, under a commercial license.
            Hosted-only modules sit behind feature flags.
          </p>
          <ul className="inc">
            {HOSTED.map((f) => (
              <li key={f} className="t-small">
                <CircleCheck />
                <span>{f}</span>
              </li>
            ))}
          </ul>
          <div className="oc-note t-small">
            Releases ship on a regular schedule. Contributions are welcome under a contributor
            license agreement.
          </div>
        </Reveal>
      </div>
    </section>
  );
}
