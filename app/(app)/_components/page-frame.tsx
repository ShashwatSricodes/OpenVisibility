import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "../_lib/cn";

/** The frame every product page sits in, with its title row. */
export function Page({
  title,
  description,
  actions,
  width = "wide",
  children,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  /** "narrow" for forms and settings, "wide" for tables and charts */
  width?: "narrow" | "wide";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 p-4 sm:p-5 lg:px-6 lg:py-5",
        width === "narrow" && "mx-auto max-w-3xl",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-base font-semibold">{title}</h1>
          {description && <p className="text-xs text-fg-subtle sm:truncate">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

export const buttonPrimary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-inverted px-3 text-[13px] font-medium text-on-inverted transition-opacity hover:opacity-90 disabled:opacity-60";

export const buttonSecondary =
  "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-[13px] font-medium text-fg-default transition-colors hover:bg-hover disabled:opacity-60";

type Action = { href: string; label: string };

/** What a page shows before it has anything to show, and what to do about it. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondary,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: ReactNode;
  action?: Action;
  secondary?: Action;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg border border-line bg-panel text-fg-default [&>svg]:size-4.5">
        {icon}
      </span>
      <h2 className="mt-4 text-sm font-semibold">{title}</h2>
      <p className="mt-1 max-w-md text-[13px] text-fg-subtle">{description}</p>
      {(action || secondary) && (
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {action && (
            <Link href={action.href} className={buttonPrimary}>
              {action.label}
            </Link>
          )}
          {secondary && (
            <Link href={secondary.href} className={buttonSecondary}>
              {secondary.label}
            </Link>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
