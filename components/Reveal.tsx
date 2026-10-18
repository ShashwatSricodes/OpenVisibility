"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  className?: string;
  /** stagger, in seconds */
  delay?: number;
  /** travel distance, px (template uses 40 for blocks, 16/32 for smaller items) */
  y?: number;
  as?: "div" | "section" | "header" | "article" | "li";
  style?: CSSProperties;
  id?: string;
};

/* Framer "appear" effect: opacity 0 / translateY(40px) → in view */
export function Reveal({
  children,
  className = "",
  delay = 0,
  y = 40,
  as = "div",
  style,
  id,
}: Props) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!("IntersectionObserver" in window)) {
      el.classList.add("in");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            el.classList.add("in");
            io.disconnect();
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Tag = as as "div";
  return (
    <Tag
      ref={ref as React.RefObject<HTMLDivElement>}
      id={id}
      className={`rv ${className}`.trim()}
      style={{ "--d": `${delay}s`, "--y": `${y}px`, ...style } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
