import { Reveal } from "./Reveal";

export function CloseCta() {
  return (
    <section className="wrap sec sec-cta" id="final-cta">
      <Reveal className="cta" as="div">
        <div className="cta-txt">
          <div>
            <h2 className="t-h2">Find out what AI says about you this week</h2>
            <p className="t-body">
              Add your brand and competitors, review the estimate, and get
              your first answers in minutes. Self-hosting is free.
            </p>
          </div>
          <a className="btn btn-primary" href="#pricing">
            Start tracking
          </a>
        </div>
        <div className="cta-bg" aria-hidden="true">
          <img
            src="/tpl/tWXpJzlIqUJNUp01qKLylcZ4s0.png"
            alt=""
            width={2493}
            height={1398}
            loading="lazy"
            decoding="async"
          />
        </div>
      </Reveal>
    </section>
  );
}
