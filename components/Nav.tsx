"use client";

import { useState } from "react";
import Link from "next/link";
import { BrandMark } from "./BrandMark";

const LINKS = [
  { href: "/#about", label: "About" },
  { href: "/#features", label: "Who it's for" },
  { href: "/#open-source", label: "Open source" },
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/blog", label: "Blog" },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <nav className={`nav${open ? " open" : ""}`}>
      <div className="nav-in">
        <div className="nav-links">
          <Link className="brand" href="/#hero" onClick={() => setOpen(false)}>
            <BrandMark id="nav" />
          </Link>
          <div className="nav-menu">
            {LINKS.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setOpen(false)}>
                {l.label}
              </Link>
            ))}
          </div>
          <div className="nav-cta">
            <Link className="btn btn-text btn-sm" href="/#pricing">
              Start tracking
            </Link>
          </div>
        </div>

        <button
          className="nav-burger"
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6 6 18"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4 7h16M4 12h16M4 17h16"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          )}
        </button>
      </div>
    </nav>
  );
}
