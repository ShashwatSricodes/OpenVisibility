/**
 * Rules for prompts: what a valid one looks like, and how they're tagged.
 * No database code, so the forms can use them as you type.
 *
 * Every prompt gets an intent tag and is tagged branded or non-branded
 * automatically. Non-branded prompts ("best invoicing software") show
 * whether AI recommends you unprompted, which is what most visibility is about;
 * branded ones ("is Ledgerly any good?") show how AI describes you.
 */

export const MAX_PROMPTS_PER_BRAND = 200;
export const MAX_TAGS = 8;

export const INTENTS = [
  "discovery",
  "comparison",
  "alternatives",
  "how-to",
  "reviews",
  "pricing",
] as const;
export type Intent = (typeof INTENTS)[number];

/** Where the intent sits in the buying journey, Otterly-style: top or bottom of the funnel. */
export const FUNNEL: Record<Intent, "top" | "bottom"> = {
  discovery: "top",
  "how-to": "top",
  comparison: "bottom",
  alternatives: "bottom",
  reviews: "bottom",
  pricing: "bottom",
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the text names the brand (or one of its other names) as a word. */
export function isBranded(text: string, names: string[]): boolean {
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .some((n) => new RegExp(`(^|[^\\p{L}\\p{N}])${escape(n)}($|[^\\p{L}\\p{N}])`, "iu").test(text));
}

/**
 * The tags a prompt is saved with: its own tags, with "branded" or
 * "non-branded" set from the text so they never go stale after an edit.
 */
export function withAutoTags(text: string, tags: string[], brandNames: string[]): string[] {
  const own = tags
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t && t !== "branded" && t !== "non-branded");
  return [...new Set([...own, isBranded(text, brandNames) ? "branded" : "non-branded"])].slice(
    0,
    MAX_TAGS,
  );
}

export function cleanPromptText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Null when the text is fine to ask, or a message saying why not. */
export function checkPromptText(text: string): string | null {
  const t = cleanPromptText(text);
  if (t.length < 3) return "Write the question out, like “best invoicing app for freelancers”.";
  if (t.length > 300) return "Keep prompts under 300 characters, like a real question to AI.";
  return null;
}
