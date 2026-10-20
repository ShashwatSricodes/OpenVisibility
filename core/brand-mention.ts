/**
 * A quick check for whether an answer names the brand: its name as a whole
 * word, or one of its domains, ignoring case. Smart sampling uses it to see
 * whether two samples agree. Full mention detection (aliases, competitors,
 * positions) comes with the analysis phase and will replace this.
 */

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function mentionsBrand(text: string, brand: { name: string; domains: string[] }): boolean {
  const terms = [brand.name, ...brand.domains].map((t) => t.trim()).filter(Boolean);
  // letters and digits on either side mean it's part of a longer word
  return terms.some((t) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escape(t)}(?![\\p{L}\\p{N}])`, "iu").test(text),
  );
}
