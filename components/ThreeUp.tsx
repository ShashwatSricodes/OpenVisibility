import { Reveal } from "./Reveal";

/* small OpenVisibility UI mocks floated over the template photos */
function MockEngines() {
  return (
    <div className="ab-ui" aria-hidden="true">
      <span className="ui-pill">
        <svg viewBox="0 0 14 14" fill="none">
          <circle cx="6.2" cy="6.2" r="4" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="m9.2 9.2 2.6 2.6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        ChatGPT · the app
      </span>
      <span className="ui-pill">
        <svg viewBox="0 0 14 14" fill="none">
          <circle cx="6.2" cy="6.2" r="4" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="m9.2 9.2 2.6 2.6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        Gemini · the app
      </span>
      <span className="ui-pill">
        <svg viewBox="0 0 14 14" fill="none">
          <circle cx="6.2" cy="6.2" r="4" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="m9.2 9.2 2.6 2.6"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        Google AI Mode · Overviews
      </span>
      <span className="ui-line" />
      <span className="ui-pill on-white">
        <svg viewBox="0 0 14 14" fill="none">
          <path
            d="M8.6 2.2a3.3 3.3 0 1 1-1.9 6L5 9.9H3.4V11H1.8V9.3l3.7-3.7a3.3 3.3 0 0 1 3.1-3.4Z"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinejoin="round"
          />
        </svg>
        By country · with every source
      </span>
    </div>
  );
}

function MockSamples() {
  return (
    <div className="ab-ui" aria-hidden="true">
      <div className="ui-card">
        <span className="k">prompt · sampled 5× on ChatGPT · India</span>
        <span className="v" style={{ fontWeight: 500 }}>
          &ldquo;best invoicing app for freelancers&rdquo;
        </span>
        <span className="ui-line" style={{ width: "100%", height: 1 }} />
        <span className="ui-dots">
          <i className="on" />
          <i className="on" />
          <i />
          <i className="on" />
          <i className="on" />
          <span className="k">mentioned 4 of 5</span>
        </span>
        <span className="k">avg position</span>
        <span className="v">#2, behind one competitor</span>
        <span className="k">cited</span>
        <span className="v">yourbrand.com/pricing · g2.com</span>
      </div>
    </div>
  );
}

function MockEstimate() {
  return (
    <div className="ab-ui" aria-hidden="true">
      <span className="ui-pill">
        <svg viewBox="0 0 14 14" fill="none">
          <path
            d="M2 11.5h10M3.5 9V6M7 9V3.5M10.5 9V5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        Estimate · 1,260 answers · $1.89
      </span>
      <span className="ui-line" />
      <span className="ui-pill">
        <svg viewBox="0 0 14 14" fill="none">
          <rect
            x="2"
            y="3.5"
            width="10"
            height="7.5"
            rx="1.6"
            stroke="currentColor"
            strokeWidth="1.2"
          />
          <path d="M2 6h10" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        Monthly limit 20,000 answers · ok
      </span>
      <span className="ui-line" />
      <span className="ui-pill on-white">
        <svg viewBox="0 0 14 14" fill="none">
          <circle cx="7" cy="7" r="5.4" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="m4.6 7.2 1.6 1.6 3.2-3.4"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Run started · 3,740 free answers left
      </span>
    </div>
  );
}

const ITEMS = [
  {
    title: "The answers people actually see",
    body: "We collect answers from the ChatGPT and Gemini apps, Google AI Mode and AI Overviews, logged out and by country, with every source they cite. Not an API that answers differently.",
    img: "/tpl/FWPrYiWLdnId4bfjvKP4ZIAFc.png",
    ui: <MockEngines />,
  },
  {
    title: "Mention rates, not anecdotes",
    body: "AI answers change from one run to the next. We ask each prompt several times and report how often you appear, not whether you got lucky once.",
    img: "/tpl/MuXnAQnWIpCXmtPsc2dcwARaPM.png",
    ui: <MockSamples />,
  },
  {
    title: "The cost, before you click run",
    body: "Every run shows how many answers it will use and what they cost, stops at your monthly limit, and counts every answer it was billed for.",
    img: "/tpl/tIICB6xb1ypwFbhAyCfXZX0yQw.png",
    ui: <MockEstimate />,
  },
];

export function ThreeUp() {
  return (
    <section className="wrap sec" id="about">
      <div className="sec-head about-head">
        <Reveal>
          <span className="eyebrow">Introducing OpenVisibility</span>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="t-h2">
            AI visibility tracking you can afford{" "}
            <span className="dim">and read the source code of.</span>
          </h2>
        </Reveal>
      </div>

      <div className="about">
        {ITEMS.map((it, i) => (
          <Reveal key={it.title} delay={0.1 * i} className="ab" as="article">
            <div className="ab-img">
              <img src={it.img} alt="" width={1456} height={816} loading="lazy" decoding="async" />
              {it.ui}
            </div>
            <div className="ab-txt">
              <h3 className="t-h3">{it.title}</h3>
              <p className="t-body">{it.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
