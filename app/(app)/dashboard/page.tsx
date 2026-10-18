import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

/* placeholder until the real overview on Day 27 */
const ENGINES = [
  { name: "ChatGPT", source: "Consumer app (Bright Data)" },
  { name: "Gemini", source: "Consumer app (Bright Data)" },
  { name: "Google AI Mode", source: "Consumer app (Bright Data)" },
  { name: "Google AI Overviews", source: "Google results (Bright Data)" },
  { name: "Perplexity", source: "Official API fallback" },
  { name: "Claude", source: "Official API" },
];

export default function DashboardPage() {
  return (
    <main className="shell">
      <h1 className="page-title">Dashboard</h1>
      <section className="card">
        <h2>No runs yet</h2>
        <p className="muted">
          Tracking starts once your brand, competitors and prompts are set up.
        </p>
        <ul className="engine-list">
          {ENGINES.map((e) => (
            <li key={e.name}>
              <span>{e.name}</span>
              <span className="status">{e.source}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
