"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  CircleHelp,
  Clock,
  Link2,
  MessageSquareText,
  ListChecks,
  Menu,
  Moon,
  Settings,
  Sun,
  Swords,
  X,
  type LucideIcon,
} from "lucide-react";
import { Logotype } from "@/components/brand/Logo";
import { cn } from "../_lib/cn";
import { FREE_TIER } from "../_lib/sample-data";

type Item = { href: string; label: string; icon: LucideIcon };

const GROUPS: { label: string; items: Item[] }[] = [
  {
    label: "Insights",
    items: [
      { href: "/dashboard", label: "Overview", icon: BarChart3 },
      { href: "/prompts", label: "Prompts", icon: ListChecks },
      { href: "/answers", label: "Answers", icon: MessageSquareText },
      { href: "/citations", label: "Citations", icon: Link2 },
      { href: "/competitors", label: "Competitors", icon: Swords },
    ],
  },
  {
    label: "Tracking",
    items: [{ href: "/runs", label: "Runs", icon: Clock }],
  },
];

function Wordmark({ id }: { id: string }) {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-2 py-1.5">
      <Logotype
        id={id}
        height={16}
        textClassName="font-display text-[14px] font-semibold tracking-tight"
      />
    </Link>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState(false);
  useEffect(() => setDark(document.documentElement.classList.contains("dark")), []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("ov-theme", next ? "dark" : "light");
    } catch {
      /* private mode: the theme just won't persist */
    }
  };

  const Icon = dark ? Sun : Moon;
  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-7 items-center gap-2 rounded-md px-2 text-[13px] text-fg-default transition-colors hover:bg-black/5 dark:hover:bg-white/5"
    >
      <Icon className="size-3.5 text-fg-subtle" strokeWidth={1.75} />
      {dark ? "Light mode" : "Dark mode"}
    </button>
  );
}

function NavLink({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-7 items-center gap-2 rounded-md px-2 text-[13px] transition-colors",
        active
          ? "bg-panel font-medium text-fg ring-1 ring-line"
          : "text-fg-default hover:bg-black/5 dark:hover:bg-white/5",
      )}
    >
      <Icon className={cn("size-3.5", active ? "text-fg" : "text-fg-subtle")} strokeWidth={1.75} />
      {item.label}
    </Link>
  );
}

function NavGroups({
  pathname,
  className,
  onNavigate,
}: {
  pathname: string;
  className?: string;
  onNavigate?: () => void;
}) {
  return (
    <nav className={cn("flex flex-col gap-5", className)} onClick={onNavigate}>
      {GROUPS.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <p className="mb-1 px-2 text-[11px] font-medium text-fg-muted">{g.label}</p>
          {g.items.map((item) => (
            <NavLink key={item.href} item={item} active={pathname === item.href} />
          ))}
        </div>
      ))}
    </nav>
  );
}

/** Top bar with a menu for screens narrower than the sidebar breakpoint. */
export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="sticky top-0 z-40 border-b border-line bg-frame/90 backdrop-blur lg:hidden">
      <div className="flex h-14 items-center justify-between px-3">
        <Wordmark id="mobile" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Close menu" : "Open menu"}
          className="flex size-9 items-center justify-center rounded-lg border border-line bg-panel text-fg-default"
        >
          {open ? <X className="size-4" /> : <Menu className="size-4" />}
        </button>
      </div>
      {open && (
        <NavGroups
          pathname={pathname}
          className="max-h-[70vh] overflow-y-auto border-t border-line px-3 py-4"
          onNavigate={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const pct = Math.round((FREE_TIER.used / FREE_TIER.limit) * 100);

  return (
    <aside className="sticky top-0 hidden h-screen flex-col gap-4 px-2.5 py-3.5 lg:flex">
      <Wordmark id="sidebar" />

      <NavGroups pathname={pathname} className="flex-1 overflow-y-auto scrollbar-hide" />

      <div className="flex flex-col gap-0.5">
        <NavLink
          item={{ href: "/settings", label: "Settings", icon: Settings }}
          active={pathname === "/settings"}
        />
        <NavLink item={{ href: "/help", label: "Help", icon: CircleHelp }} active={false} />
        <ThemeToggle />
      </div>

      <div className="rounded-lg border border-line bg-panel p-2.5">
        <div className="flex items-baseline justify-between text-xs">
          <span className="font-medium text-fg">Free answers</span>
          <span className="tabular text-fg-subtle">
            {FREE_TIER.used.toLocaleString("en-US")} / {FREE_TIER.limit.toLocaleString("en-US")}
          </span>
        </div>
        <div
          className="mt-2 h-1.5 overflow-hidden rounded-full bg-pressed"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Bright Data free tier used"
        >
          <div className="h-full rounded-full bg-fg" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-1.5 text-[11px] text-fg-subtle">Bright Data · resets {FREE_TIER.resets}</p>
      </div>
    </aside>
  );
}
