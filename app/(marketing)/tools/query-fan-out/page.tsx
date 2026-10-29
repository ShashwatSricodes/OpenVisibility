import type { Metadata } from "next";
import { ToolFrame } from "../frame";
import { FanOutTool } from "../forms";

export const metadata: Metadata = {
  title: "ChatGPT query fan-out tool — OpenVisibility",
  description:
    "See the web searches ChatGPT runs to answer a question, and the sources it cites. Free, one real answer.",
};

export default function Page() {
  return (
    <ToolFrame
      eyebrow="Query fan-out"
      title="What does ChatGPT search for?"
      intro="Before it answers, ChatGPT searches the web. Those searches decide which pages it can find and quote. This asks ChatGPT your question as a logged-out visitor and shows them. Three a day, free."
      upsell="OpenVisibility asks every engine all your buyers' questions on a schedule, and tracks how often you're named, against whom, and from which sources."
    >
      <FanOutTool />
    </ToolFrame>
  );
}
