export type Block =
  | { type: "p"; text: string }
  | { type: "h2"; text: string }
  | { type: "code"; lang: string; code: string }
  | { type: "ul"; items: string[] };

export type Post = {
  slug: string;
  title: string;
  excerpt: string;
  date: string; // ISO
  readingTime: string;
  author: { name: string; role: string };
  cover: string;
  tag: string;
  body: Block[];
};

export const POSTS: Post[] = [
  {
    slug: "what-api-based-ai-visibility-tracking-measures",
    title: "What API-based AI visibility tracking actually measures",
    excerpt:
      "AI answers vary from one run to the next, and the API isn't the app. Here's how OpenVisibility samples, what the numbers mean, and where they stop.",
    date: "2026-10-01",
    readingTime: "5 min read",
    author: { name: "OpenVisibility team", role: "Product" },
    cover: "/tpl/tWXpJzlIqUJNUp01qKLylcZ4s0.png",
    tag: "Measurement",
    body: [
      {
        type: "p",
        text: "Ask ChatGPT for the best invoicing app for freelancers five times and you can get five different lists. That's the first problem with AI visibility: a single answer tells you almost nothing. The second problem is that the cheapest, most stable way to ask is through the API, and the API is not the consumer app. This post explains how we handle both.",
      },
      { type: "h2", text: "Sample, then count" },
      {
        type: "p",
        text: "OpenVisibility sends each prompt to each engine several times per run and reports a mention rate: the share of samples that named your brand. Position, share of voice and sentiment are calculated across those same samples, so a lucky run doesn't look like a trend.",
      },
      {
        type: "ul",
        items: [
          "Search-grounded models only, so every answer arrives with the sources it cites.",
          "User location is passed where the provider supports it, for country-level results.",
          "Cheap models handle parsing the answers, so analysis doesn't cost more than the query.",
          "Every answer is archived with its model, sample number, country and cost.",
        ],
      },
      { type: "h2", text: "Every response carries its own price" },
      {
        type: "p",
        text: "On the hosted version, requests go through Vercel AI Gateway, which reports the exact cost of each response. We store it per run and per customer, which is how the dashboard can show a per-engine cost breakdown instead of a guess.",
      },
      {
        type: "code",
        lang: "ts",
        code: `const result = await generateText({
  model: "openai/gpt-5",
  prompt: "best invoicing app for freelancers",
  tools: { web_search: openai.tools.webSearch() },
});

// stored against the run, the prompt, and the sample
const cost = result.providerMetadata?.gateway?.cost;`,
      },
      {
        type: "p",
        text: "Self-hosted installs work the same way with your own keys: Vercel AI Gateway, OpenRouter, or each provider directly. Before any run starts you get an estimate, and a budget cap stops tracking rather than overspending.",
      },
      { type: "h2", text: "Where the numbers stop" },
      {
        type: "p",
        text: "API answers measure how a model responds. The ChatGPT and Perplexity apps add their own system prompts, personalisation and interface on top, so your mention rate in the app may differ. We think that's an acceptable trade for tracking that stays within provider terms and costs the same next month as it does today, and we say so in onboarding and in every report.",
      },
      {
        type: "p",
        text: "Google AI Overviews is the notable gap. It has no official API, so we plan to add it in version 2 through a SERP data provider rather than scraping.",
      },
    ],
  },
];

export function getPost(slug: string) {
  return POSTS.find((p) => p.slug === slug);
}

export function formatDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
