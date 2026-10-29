import Link from "next/link";
import type { ReactNode } from "react";
import { Footer } from "@/components/Footer";
import { Nav } from "@/components/Nav";

/** Every tool page: the heading, the tool, and what the product adds. */
export function ToolFrame({
  eyebrow,
  title,
  intro,
  upsell,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  /** what tracking adds over this one-off check */
  upsell: string;
  children: ReactNode;
}) {
  return (
    <>
      <Nav />
      <main className="page">
        <section className="wrap sec">
          <div className="sec-head">
            <Link href="/tools" className="eyebrow">
              Free tools · {eyebrow}
            </Link>
            <h1 className="t-h2">{title}</h1>
            <p className="t-body tool-muted" style={{ maxWidth: 680 }}>
              {intro}
            </p>
          </div>
          <div className="tool-shell">
            {children}
            <div className="tool-cta">
              <p className="t-body" style={{ maxWidth: 520 }}>
                {upsell}
              </p>
              <Link className="btn btn-primary" href="/login">
                Start tracking free
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
