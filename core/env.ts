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

  /** Signs session cookies. Required in production; `openssl rand -base64 32` makes one */
  BETTER_AUTH_SECRET: optionalString,
  /** Public URL of the app, used in magic links */
  BETTER_AUTH_URL: z.string().trim().url().default("http://localhost:3000"),

  /** Encrypts API keys saved in the database. Required in production: `openssl rand -base64 32` */
  ENCRYPTION_KEY: optionalString.pipe(
    z.string().min(32, "must be at least 32 characters; use `openssl rand -base64 32`").optional(),
  ),

  /** Email delivery. Without a key, emails are printed to the terminal */
  RESEND_API_KEY: optionalString,
  EMAIL_FROM: z.string().trim().default("OpenVisibility <login@openvisibility.dev>"),

  /** Consumer-app answers (ChatGPT, Gemini, AI Mode, AI Overviews, Perplexity) */
  BRIGHT_DATA_API_KEY: optionalString,
  /** Official model APIs (Claude, and fallbacks for the other engines); also writes prompt suggestions */
  AI_GATEWAY_API_KEY: optionalString,
  /** The model that writes prompt suggestions when AI_GATEWAY_API_KEY is set */
  PROMPT_SUGGEST_MODEL: z.string().trim().default("google/gemini-3.5-flash-lite"),
  /**
   * The analysis model: rates sentiment and recommendations in answers.
   * Any OpenAI-compatible API (Groq, Gemini, OpenRouter, Cerebras, DeepSeek,
   * Ollama…). Off until ANALYSIS_BASE_URL and ANALYSIS_MODEL are set.
   */
  ANALYSIS_BASE_URL: optionalString.pipe(z.string().url().optional()),
  /** optional: a local Ollama needs none */
  ANALYSIS_API_KEY: optionalString,
  ANALYSIS_MODEL: optionalString,
  /** answers rated per call */
  ANALYSIS_BATCH: z.coerce.number().int().min(1).max(20).default(5),
  /** US dollars per million tokens, for cost tracking; 0 on free tiers */
  ANALYSIS_PRICE_INPUT: z.coerce.number().min(0).default(0),
  ANALYSIS_PRICE_OUTPUT: z.coerce.number().min(0).default(0),
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
