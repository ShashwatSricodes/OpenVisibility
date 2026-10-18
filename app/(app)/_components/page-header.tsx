"use client";

import { useEffect, useState } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Calendar, Check, ChevronDown, Globe, Moon, Play, Sun } from "lucide-react";
import { cn } from "../_lib/cn";

const RANGES = ["Last 7 days", "Last 30 days", "Last 90 days", "Month to date"];
const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "IN", name: "India" },
  { code: "GB", name: "United Kingdom" },
];

function Select({
  icon,
  value,
  options,
  onChange,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  label: string;
}) {
  const current = options.find((o) => o.value === value);
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className="flex h-9 items-center gap-2 rounded border border-line bg-panel px-3 text-sm text-fg-default outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-line-strong data-[state=open]:bg-hover"
      >
        <span className="text-fg-subtle">{icon}</span>
        <span className="whitespace-nowrap">{current?.label}</span>
        <ChevronDown className="size-4 text-fg-muted" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-48 rounded border border-line bg-panel p-1 text-sm text-fg shadow-[0_8px_24px_rgb(0_0_0/0.08)]"
        >
          {options.map((o) => (
            <Menu.Item
              key={o.value}
              onSelect={() => onChange(o.value)}
              className="flex h-8 cursor-default items-center justify-between gap-6 rounded-xs px-2 outline-none data-[highlighted]:bg-hover"
            >
              {o.label}
              {o.value === value && <Check className="size-4" strokeWidth={2.25} />}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
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
      /* private mode: theme just won't persist */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
      className="flex size-9 items-center justify-center rounded border border-line bg-panel text-fg-subtle transition-colors hover:bg-hover hover:text-fg"
    >
      {dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  );
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const [range, setRange] = useState("Last 30 days");
  const [country, setCountry] = useState("US");

  return (
    <header className="flex flex-col gap-4 border-b border-line px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-0.5 truncate text-sm text-fg-subtle">{subtitle}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          label="Date range"
          icon={<Calendar className="size-4" />}
          value={range}
          onChange={setRange}
          options={RANGES.map((r) => ({ value: r, label: r }))}
        />
        <Select
          label="Country"
          icon={<Globe className="size-4" />}
          value={country}
          onChange={setCountry}
          options={COUNTRIES.map((c) => ({ value: c.code, label: c.name }))}
        />
        <ThemeToggle />
        <button
          type="button"
          className={cn(
            "flex h-9 items-center gap-2 rounded bg-inverted px-3.5 text-sm font-medium text-on-inverted transition-opacity hover:opacity-90",
          )}
        >
          <Play className="size-3.5 fill-current" />
          Run now
        </button>
      </div>
    </header>
  );
}
