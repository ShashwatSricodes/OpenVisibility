/**
 * Environment variables, validated in one place.
 *
 * Everything is optional at parse time: a self-hoster may run only the engines
 * they have keys for. Code that needs a key calls `requireEnv`, which fails
 * with a message saying what the key is for and where to get it.
 */

import { z } from "zod";

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  /** Postgres connection string; docker-compose.yml provides one for local work */
  DATABASE_URL: optionalString.pipe(
    z
      .string()
      .regex(/^postgres(ql)?:\/\//, "must start with postgres:// or postgresql://")
      .optional(),
  ),

  /** Consumer-app answers (ChatGPT, Gemini, AI Mode, AI Overviews, Perplexity) */
  BRIGHT_DATA_API_KEY: optionalString,
  /** Official model APIs (Claude, and fallbacks for the other engines) */
  AI_GATEWAY_API_KEY: optionalString,
  /** Perplexity's own API, for the Accurate preset on the API route */
  PERPLEXITY_API_KEY: optionalString,
  PERPLEXITY_DIRECT_MODEL: z.string().trim().default("sonar-pro"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Parse and validate process.env once. Throws listing every invalid variable. */
export function env(source: Record<string, string | undefined> = process.env): Env {
  if (cached && source === process.env) return cached;
  const result = schema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${problems}\nSee .env.example.`);
  }
  if (source === process.env) cached = result.data;
  return result.data;
}

const HINTS = {
  DATABASE_URL:
    "Postgres connection string. For local development run `docker compose up -d` and use postgres://openvisibility:openvisibility@localhost:5432/openvisibility.",
  BRIGHT_DATA_API_KEY:
    "Bright Data key for consumer-app answers. Free account (5,000 answers a month): brightdata.com → Account settings → API key.",
  AI_GATEWAY_API_KEY:
    "Vercel AI Gateway key for official model APIs (Claude). Vercel dashboard → AI Gateway → API Keys.",
  PERPLEXITY_API_KEY: "Perplexity API key, only for the Accurate Perplexity preset.",
} as const;

type KeyName = keyof typeof HINTS;

/** Get a key that the current operation can't run without. */
export function requireEnv(name: KeyName, source?: Record<string, string | undefined>): string {
  const value = env(source)[name];
  if (!value) throw new Error(`${name} is not set. ${HINTS[name]} Add it to .env.local.`);
  return value;
}
