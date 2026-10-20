"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  LogOut,
  BarChart3,
  CircleHelp,
  CreditCard,
  Clock,
  Link2,
  MessageSquareText,
  ListChecks,
  Menu,
  Moon,
  ScanSearch,
  Settings,
  Sun,
  Swords,
  X,
  type LucideIcon,
} from "lucide-react";
import { Logotype } from "@/components/brand/Logo";
import { authClient } from "@/core/auth/client";
import { cn } from "../_lib/cn";
import type { FreeTierUsage } from "@/core/usage";

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
    label: "Improve",
    items: [{ href: "/audit", label: "Site audit", icon: ScanSearch }],
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
            <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
          ))}
        </div>
      ))}
    </nav>
  );
}

export type Account = {
  email: string;
  workspace: string;
  /** hosted workspaces pay through a wallet, so they get a Billing page */
  hosted: boolean;
};

/** Settings, Billing (hosted only) and Help: below the main groups. */
function footerItems(hosted: boolean): Item[] {
  return [
    { href: "/settings", label: "Settings", icon: Settings },
    ...(hosted ? [{ href: "/billing", label: "Billing", icon: CreditCard }] : []),
    { href: "/help", label: "Help", icon: CircleHelp },
  ];
}

const isActive = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

function AccountMenu({ account }: { account: Account }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const signOut = async () => {
    setSigningOut(true);
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-line-strong data-[state=open]:bg-black/5 dark:hover:bg-white/5 dark:data-[state=open]:bg-white/5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-inverted text-[11px] font-semibold uppercase text-on-inverted">
          {account.email[0]}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] text-fg">{account.email}</span>
          <span className="block truncate text-[11px] text-fg-subtle">{account.workspace}</span>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="top"
          align="start"
          sideOffset={6}
          className="z-50 min-w-48 rounded-lg border border-line bg-panel p-1 text-[13px] text-fg shadow-[0_8px_24px_rgb(0_0_0/0.08)]"
        >
          <DropdownMenu.Item
            disabled={signingOut}
            onSelect={(e) => {
              e.preventDefault();
              void signOut();
            }}
            className="flex h-7 cursor-default items-center gap-2 rounded-md px-2 outline-none data-[highlighted]:bg-hover data-[disabled]:opacity-50"
          >
            <LogOut className="size-3.5 text-fg-subtle" />
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Top bar with a menu for screens narrower than the sidebar breakpoint. */
export function MobileNav({ account }: { account: Account }) {
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
        <div className="max-h-[75vh] overflow-y-auto border-t border-line px-3 py-4">
          <NavGroups pathname={pathname} onNavigate={() => setOpen(false)} />
          <div className="mt-4 flex flex-col gap-0.5" onClick={() => setOpen(false)}>
            {footerItems(account.hosted).map((item) => (
              <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
            ))}
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <AccountMenu account={account} />
          </div>
        </div>
      )}
    </div>
  );
}

const resetDay = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Bright Data's free answers this month, for the account this workspace's key belongs to. */
function UsageMeter({ usage }: { usage: FreeTierUsage }) {
  if (!usage.keySource)
    return (
      <Link
        href="/settings"
        className="block rounded-lg border border-line bg-panel p-2.5 text-xs transition-colors hover:bg-hover"
      >
        <span className="font-medium text-fg">No Bright Data key</span>
        <span className="mt-0.5 block text-[11px] text-fg-subtle">
          Add one in Settings to start tracking
        </span>
      </Link>
    );

  const used = usage.used;
  const pct = used === null ? 0 : Math.min(100, Math.round((used / usage.limit) * 100));
  return (
    <Link
      href="/settings"
      title={usage.error}
      className="block rounded-lg border border-line bg-panel p-2.5 transition-colors hover:bg-hover"
    >
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-medium text-fg">Free answers</span>
        <span className="tabular text-fg-subtle">
          {used === null ? "–" : used.toLocaleString("en-US")} /{" "}
          {usage.limit.toLocaleString("en-US")}
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
        <div
          className={cn(
            "h-full rounded-full",
            pct >= 100 ? "bg-bad" : pct >= 80 ? "bg-[var(--series-4)]" : "bg-fg",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-1.5 text-[11px] text-fg-subtle">
        {used === null
          ? "Usage unavailable right now"
          : `${usage.keySource === "workspace" ? "Your key" : "Server key"} · resets ${resetDay(usage.resetsAt)}`}
      </p>
    </Link>
  );
}

export function Sidebar({ account, usage }: { account: Account; usage: FreeTierUsage }) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen flex-col gap-4 px-2.5 py-3.5 lg:flex">
      <Wordmark id="sidebar" />

      <NavGroups pathname={pathname} className="flex-1 overflow-y-auto scrollbar-hide" />

      <div className="flex flex-col gap-0.5">
        {footerItems(account.hosted).map((item) => (
          <NavLink key={item.href} item={item} active={isActive(pathname, item.href)} />
        ))}
        <ThemeToggle />
      </div>

      <UsageMeter usage={usage} />

      <AccountMenu account={account} />
    </aside>
  );
}
