import type { Metadata } from "next";
import { ToolFrame } from "../frame";
import { CrawlabilityTool } from "../forms";

export const metadata: Metadata = {
  title: "Free AI crawler checker — OpenVisibility",
  description:
    "Check whether GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot and Googlebot can read your page: robots.txt, noindex and JavaScript-only text.",
};

export default function Page() {
  return (
    <ToolFrame
      eyebrow="AI crawler check"
      title="Can AI crawlers read your page?"
      intro="Most AI crawlers don't run JavaScript and all of them read robots.txt. This checks a page the way they fetch it, crawler by crawler."
      upsell="OpenVisibility audits your whole site every week, shows which AI crawlers actually visit, and tracks whether ChatGPT, Gemini and Perplexity name you."
    >
      <CrawlabilityTool />
    </ToolFrame>
  );
}
