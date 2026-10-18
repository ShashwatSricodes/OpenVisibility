"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  ChevronsUpDown,
  CircleHelp,
  Clock,
  Link2,
  MessageSquareText,
  ListChecks,
  Menu,
  Settings,
  Swords,
  X,
  type LucideIcon,
} from "lucide-react";
import { Logotype } from "@/components/brand/Logo";
import { cn } from "../_lib/cn";
import { BRAND, FREE_TIER } from "../_lib/sample-data";

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
    <Link href="/dashboard" className="flex items-center gap-2 px-2 py-1">
      <Logotype
        id={id}
        height={19}
        textClassName="font-display text-[15px] font-semibold tracking-tight"
      />
    </Link>
  );
}

function NavLink({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded px-2.5 text-sm transition-colors",
        active
          ? "bg-panel font-medium text-fg ring-1 ring-line"
          : "text-fg-default hover:bg-black/5 dark:hover:bg-white/5",
      )}
    >
      <Icon className={cn("size-4", active ? "text-fg" : "text-fg-subtle")} strokeWidth={1.75} />
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
    <nav className={cn("flex flex-col gap-6", className)} onClick={onNavigate}>
      {GROUPS.map((g) => (
        <div key={g.label} className="flex flex-col gap-0.5">
          <p className="mb-1 px-2.5 text-xs font-medium text-fg-muted">{g.label}</p>
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
          className="flex size-9 items-center justify-center rounded border border-line bg-panel text-fg-default"
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
    <aside className="sticky top-0 hidden h-screen flex-col gap-5 px-3 py-4 lg:flex">
      <Wordmark id="sidebar" />

      <button
        type="button"
        className="flex items-center gap-2.5 rounded border border-line bg-panel px-2.5 py-2 text-left transition-colors hover:bg-hover"
      >
        <span className="flex size-7 items-center justify-center rounded-xs bg-linear-to-br from-blue-500 to-violet-500 text-xs font-semibold text-white">
          {BRAND.name[0]}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{BRAND.name}</span>
          <span className="block truncate text-xs text-fg-subtle">{BRAND.domain}</span>
        </span>
        <ChevronsUpDown className="size-4 text-fg-muted" />
      </button>

      <NavGroups pathname={pathname} className="flex-1 overflow-y-auto scrollbar-hide" />

      <div className="flex flex-col gap-0.5">
        <NavLink
          item={{ href: "/settings", label: "Settings", icon: Settings }}
          active={pathname === "/settings"}
        />
        <NavLink item={{ href: "/help", label: "Help", icon: CircleHelp }} active={false} />
      </div>

      <div className="rounded border border-line bg-panel p-3">
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
        <p className="mt-2 text-xs text-fg-subtle">Bright Data · resets {FREE_TIER.resets}</p>
      </div>
    </aside>
  );
}
