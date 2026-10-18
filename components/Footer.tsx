import Link from "next/link";
import { BrandMark } from "./BrandMark";

const NAV = [
  { href: "/#about", label: "About" },
  { href: "/#features", label: "Who it's for" },
  { href: "/#open-source", label: "Open source" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
];

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <div className="foot-l">
          <div className="foot-top">
            <Link className="brand" href="/#hero">
              <BrandMark />
              OpenVisibility
            </Link>
            <p className="t-small">
              Open-source AI visibility tracking, priced for the rest of us.
            </p>
            <div className="socials">
              <a href="https://x.com" aria-label="X">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 4l16 16M20 4 4 20"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </a>
              <a href="https://github.com/ShashwatSricodes/OpenVisibility" aria-label="GitHub">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M12 3a9 9 0 0 0-2.8 17.5c.4.1.6-.2.6-.4v-1.6c-2.5.5-3-1.1-3-1.1-.4-1-1-1.3-1-1.3-.8-.5.1-.5.1-.5.9.1 1.4.9 1.4.9.8 1.4 2.1 1 2.6.8.1-.6.3-1 .6-1.2-2-.2-4.1-1-4.1-4.4 0-1 .3-1.8.9-2.4-.1-.3-.4-1.2.1-2.4 0 0 .8-.2 2.5.9a8.6 8.6 0 0 1 4.6 0c1.7-1.1 2.5-.9 2.5-.9.5 1.2.2 2.1.1 2.4.6.6.9 1.4.9 2.4 0 3.4-2.1 4.2-4.1 4.4.3.3.6.8.6 1.6v2.4c0 .2.2.5.6.4A9 9 0 0 0 12 3Z"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                  />
                </svg>
              </a>
              <a href="https://linkedin.com" aria-label="LinkedIn">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect
                    x="3.5"
                    y="3.5"
                    width="17"
                    height="17"
                    rx="2"
                    stroke="currentColor"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M8 10v6M8 7.5v.1M12 16v-3.5a2 2 0 0 1 4 0V16"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                  />
                </svg>
              </a>
            </div>
          </div>
          <div className="foot-by">
            <span>&copy; 2026</span>
            <b>OpenVisibility</b>
            <span>&middot; AGPL-3.0</span>
          </div>
        </div>

        <div className="foot-r">
          <div className="foot-col">
            <h4>Navigation</h4>
            {NAV.map((l) => (
              <Link key={l.href} href={l.href}>
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
