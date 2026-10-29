import type { Metadata } from "next";
import { ToolFrame } from "../frame";
import { ContentTool } from "../forms";

export const metadata: Metadata = {
  title: "Free AI content checker — OpenVisibility",
  description:
    "Score how ready a page is to be quoted by ChatGPT, Perplexity and Google AI Overviews, with the fixes that matter most.",
};

export default function Page() {
  return (
    <ToolFrame
      eyebrow="Content check"
      title="Is your page ready to be quoted by AI?"
      intro="AI answers quote pages that state things plainly: question headings, lists and tables, structured data, a date, an author, the brand named in words. This scores a page on each."
      upsell="OpenVisibility scores every page of your site and compares them with the pages AI actually cites for your buyers' questions."
    >
      <ContentTool />
    </ToolFrame>
  );
}
