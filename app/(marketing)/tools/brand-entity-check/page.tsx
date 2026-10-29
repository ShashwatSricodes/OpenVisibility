import type { Metadata } from "next";
import { ToolFrame } from "../frame";
import { EntityTool } from "../forms";

export const metadata: Metadata = {
  title: "Brand entity checker for AI — OpenVisibility",
  description:
    "Check whether AI and search engines know your brand as a company: Wikipedia, Wikidata, Organization markup and linked profiles.",
};

export default function Page() {
  return (
    <ToolFrame
      eyebrow="Brand entity check"
      title="Does AI know your brand?"
      intro="Models tell a company apart from a common word through a few public signals. This checks yours, and says what's missing."
      upsell="OpenVisibility tracks whether AI answers name your brand, and sends you the pages to get onto when they don't."
    >
      <EntityTool />
    </ToolFrame>
  );
}
