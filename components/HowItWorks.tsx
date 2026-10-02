"use client";

import { useEffect, useRef, useState } from "react";
import { Reveal } from "./Reveal";

const STEPS = [
  {
    title: "1 – Describe your brand",
    body: "Add your brand, its aliases, your competitors and the countries you sell in. We suggest prompts your customers are likely to ask.",
    img: "/tpl/cQgSHLEJcg9JwD4sAChNyOWRgU.jpg",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M14.5 4.5a5 5 0 1 1-2.9 9.1L9 16.2H6.5V18H4v-2.6l5.6-5.6a5 5 0 0 1 4.9-5.3Z"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="15.5" cy="8.5" r="1" fill="currentColor" />
      </svg>
    ),
  },
  {
    title: "2 – Pick engines and a preset",
    body: "Choose the engines, how many samples per prompt, and a schedule. Accurate mirrors each app's default model; Budget gives directional data for less.",
    img: "/tpl/hqYHNdaY2RHeMGJRbY1VkWvic.jpg",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M4 12h14M13 7l5 5-5 5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: "3 – Read the answers",
    body: "Mention rate, position, share of voice, citations and sentiment, with every answer archived and exportable to CSV.",
    img: "/tpl/MtAPMlFG7WjGMRMvNEtWXiIXeI.jpg",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="8.5" stroke="currentColor" strokeWidth="1.4" />
        <path
          d="m8.2 12.2 2.5 2.5 5-5.2"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
];

export function HowItWorks() {
  const [at, setAt] = useState(0);
  const touched = useRef(false);

  /* gentle auto-advance until the reader takes over */
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => {
      if (!touched.current) setAt((i) => (i + 1) % STEPS.length);
    }, 4200);
    return () => clearInterval(t);
  }, []);

  return (
    <section className="wrap sec" id="how-it-works">
      <div className="sec-head hw-head">
        <Reveal>
          <span className="eyebrow">How it works</span>
        </Reveal>
        <Reveal delay={0.1}>
          <h2 className="t-h2">
            Five minutes of setup
            <span className="dim">, then answers on a schedule.</span>
          </h2>
        </Reveal>
      </div>

      <Reveal className="hw" delay={0.15}>
        <div className="hw-img" aria-hidden="true">
          {STEPS.map((s, i) => (
            <img
              key={s.img}
              src={s.img}
              alt=""
              width={1032}
              height={800}
              loading="lazy"
              decoding="async"
              className={i === at ? "on" : ""}
            />
          ))}
        </div>

        <div className="hw-steps" role="tablist" aria-label="Steps">
          {STEPS.map((s, i) => (
            <button
              key={s.title}
              type="button"
              role="tab"
              className="step"
              aria-selected={i === at}
              onClick={() => {
                touched.current = true;
                setAt(i);
              }}
            >
              <span className="step-h">
                {s.icon}
                <span className="t-h3">{s.title}</span>
              </span>
              <p className="t-body">{s.body}</p>
            </button>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
