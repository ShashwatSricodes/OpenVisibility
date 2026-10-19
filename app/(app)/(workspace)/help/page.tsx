import type { Metadata } from "next";
import { BookOpen, Bug, Database, Gauge } from "lucide-react";
import { Page } from "../../_components/page-frame";

export const metadata: Metadata = { title: "Help" };

const REPO = "https://github.com/ShashwatSricodes/OpenVisibility";

const LINKS = [
  {
    icon: BookOpen,
    title: "Getting started",
    body: "Install, configure and run OpenVisibility yourself.",
    href: `${REPO}#readme`,
  },
  {
    icon: Database,
    title: "Where answers come from",
    body: "Which engines we reach, how, what each costs, and what we measured.",
    href: `${REPO}/blob/main/docs/providers.md`,
  },
  {
    icon: Gauge,
    title: "Usage and limits",
    body: "Bright Data's free 5,000 answers a month, and how runs stay inside its rate limits.",
    href: "/settings",
  },
  {
    icon: Bug,
    title: "Report a problem",
    body: "Open an issue on GitHub. Include what you did and what you expected.",
    href: `${REPO}/issues/new`,
  },
];

export default function HelpPage() {
  return (
    <Page title="Help" description="How OpenVisibility works, and where to ask" width="narrow">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {LINKS.map(({ icon: Icon, title, body, href }) => (
          <a
            key={title}
            href={href}
            {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}
            className="rounded-xl border border-line bg-panel p-4 transition-colors hover:bg-hover"
          >
            <Icon className="size-4 text-fg-subtle" strokeWidth={1.75} />
            <p className="mt-3 text-[13px] font-semibold">{title}</p>
            <p className="mt-1 text-xs text-fg-subtle">{body}</p>
          </a>
        ))}
      </div>

      <section className="rounded-xl border border-line bg-panel p-5 text-[13px] text-fg-default">
        <h2 className="text-sm font-semibold text-fg">How to read the results</h2>
        <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4">
          <li>
            Answers come from the real apps, asked logged out, through Bright Data. People who are
            signed in, or who pay for a stronger model, may see different answers.
          </li>
          <li>
            AI answers vary from one ask to the next, so each prompt is asked 3 times per engine and
            country, and results are shown as rates rather than single yes-or-no answers.
          </li>
          <li>
            Google shows an AI Overview for only some searches. When it shows none, that is a
            result, not an error.
          </li>
        </ul>
      </section>
    </Page>
  );
}
