/**
 * Rules for a brand and its competitors, as entered in onboarding.
 * No database code, so the wizard can check input as it's typed.
 */

import { z } from "zod";

export const MAX_COMPETITORS = 20;
export const MAX_LIST = 10;

/**
 * Reduce what people paste to a bare host: "https://www.Zoho.com/invoice?x=1"
 * becomes "zoho.com". Citations are matched by domain, so paths don't belong.
 */
export function normalizeDomain(raw: string): string {
  let v = raw.trim().toLowerCase();
  v = v.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  v = v.split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/\.$/, "");
  return v;
}

const DOMAIN = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const isDomain = (v: string) => DOMAIN.test(v);

/** Trim, drop empties and case-insensitive duplicates, keep the first spelling. */
export function cleanList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const v = raw.trim().replace(/\s+/g, " ");
    const key = v.toLowerCase();
    if (v && !seen.has(key)) {
      seen.add(key);
      out.push(v);
    }
  }
  return out;
}

const name = z
  .string()
  .trim()
  .min(1, "Give it a name.")
  .max(80, "Keep the name under 80 characters.");

const domains = z
  .array(z.string())
  .transform((list) => cleanList(list.map(normalizeDomain)))
  .pipe(
    z
      .array(
        z.string().refine(isDomain, {
          error: (iss) => `"${String(iss.input)}" isn't a domain, like example.com.`,
        }),
      )
      .max(MAX_LIST, `At most ${MAX_LIST} domains.`),
  );

const aliases = z
  .array(z.string())
  .transform(cleanList)
  .pipe(z.array(z.string().max(80)).max(MAX_LIST, `At most ${MAX_LIST} other names.`));

export const brandSchema = z.object({
  name,
  description: z
    .string()
    .trim()
    .max(280, "Keep the description to one or two sentences (280 characters).")
    .transform((v) => v || null),
  domains,
  aliases,
});

export const competitorSchema = z.object({ name, domains, aliases });

export type BrandInput = z.input<typeof brandSchema>;
export type BrandSetup = z.output<typeof brandSchema>;
export type CompetitorInput = z.input<typeof competitorSchema>;
export type CompetitorSetup = z.output<typeof competitorSchema>;

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const firstIssue = (e: z.ZodError) => e.issues[0]?.message ?? "Check what you entered.";

export function validateBrand(input: BrandInput): Result<BrandSetup> {
  const r = brandSchema.safeParse(input);
  if (!r.success) return { ok: false, message: firstIssue(r.error) };
  // a brand's other names shouldn't repeat its name
  const value = {
    ...r.data,
    aliases: r.data.aliases.filter((a) => a.toLowerCase() !== r.data.name.toLowerCase()),
  };
  return { ok: true, value };
}

export function validateCompetitors(
  brandName: string,
  input: CompetitorInput[],
): Result<CompetitorSetup[]> {
  if (input.length > MAX_COMPETITORS)
    return { ok: false, message: `Track at most ${MAX_COMPETITORS} competitors.` };
  const out: CompetitorSetup[] = [];
  const names = new Set<string>();
  for (const c of input) {
    const r = competitorSchema.safeParse(c);
    if (!r.success)
      return { ok: false, message: `${c.name || "A competitor"}: ${firstIssue(r.error)}` };
    const key = r.data.name.toLowerCase();
    if (key === brandName.trim().toLowerCase())
      return { ok: false, message: `${r.data.name} is your own brand, not a competitor.` };
    if (names.has(key)) return { ok: false, message: `${r.data.name} is listed twice.` };
    names.add(key);
    out.push({
      ...r.data,
      aliases: r.data.aliases.filter((a) => a.toLowerCase() !== key),
    });
  }
  return { ok: true, value: out };
}
