import Link from "next/link";
import { cn } from "../_lib/cn";

/** A row of links that behaves like tabs. */
export function Segments({ items }: { items: { href: string; label: string; active: boolean }[] }) {
  return (
    <nav className="flex rounded-lg border border-line p-0.5 text-[13px]">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.active ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1",
            i.active
              ? "bg-inverted font-medium text-on-inverted"
              : "text-fg-subtle hover:bg-hover hover:text-fg",
          )}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}
