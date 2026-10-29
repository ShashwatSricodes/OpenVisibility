import type { Metadata } from "next";
import { ToolFrame } from "../frame";
import { CalculatorTool } from "../forms";

export const metadata: Metadata = {
  title: "AI visibility prompt calculator — OpenVisibility",
  description:
    "How many prompts and samples you need for a reliable AI mention rate, and what tracking them costs.",
};

export default function Page() {
  return (
    <ToolFrame
      eyebrow="Prompt calculator"
      title="How many prompts do you need?"
      intro="AI answers change from one asking to the next, so one answer proves little. This works out how many answers give a mention rate you can trust, and what that costs at Bright Data's prices."
      upsell="OpenVisibility asks each prompt several times per run and shows how many answers every number rests on."
    >
      <CalculatorTool />
    </ToolFrame>
  );
}
