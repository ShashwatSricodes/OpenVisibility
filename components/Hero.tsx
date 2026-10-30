import type { CSSProperties } from "react";

const HEADLINE = "See how AI answers talk about your brand.";

/* template staggers the headline word by word (translateY 12px) */
function Words({ text }: { text: string }) {
  return (
    <>
      {text.split(" ").map((w, i) => (
        <span
          key={`${w}-${i}`}
          className="w"
          style={{ "--i": `${0.08 + i * 0.07}s` } as CSSProperties}
        >
          {w}
          {i < text.split(" ").length - 1 ? " " : ""}
        </span>
      ))}
    </>
  );
}

export function Hero() {
  return (
    <header className="hero" id="hero">
      <div className="hero-c">
        <div className="hero-t">
          <h1 className="t-hero">
            <Words text={HEADLINE} />
          </h1>
          <p className="hero-sub t-body">
            Open-source tracking of the answers ChatGPT, Gemini and Google&rsquo;s AI give your
            customers, then the fixes, pages and outreach that get you cited. Pay per answer, from
            $0.0015.
          </p>
        </div>
        <div className="hero-cta">
          <a className="btn btn-primary" href="#pricing">
            Start tracking
          </a>
          <a className="btn btn-text" href="https://github.com/ShashwatSricodes/OpenVisibility">
            Self-host on GitHub
          </a>
        </div>
      </div>

      <div className="hero-scroll" aria-hidden="true">
        <svg viewBox="0 0 20 20" fill="none">
          <rect
            x="6"
            y="2.5"
            width="8"
            height="15"
            rx="4"
            stroke="currentColor"
            strokeWidth="1.3"
          />
          <path d="M10 6v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
        <span>Scroll to explore</span>
      </div>

      <div className="hero-bg" aria-hidden="true">
        <img
          src="/tpl/LzblaeZXHMibAuWgYhFsP59pXk.png"
          alt=""
          width={2912}
          height={1632}
          fetchPriority="high"
          decoding="async"
        />
      </div>
    </header>
  );
}
