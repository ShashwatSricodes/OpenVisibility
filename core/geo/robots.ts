/**
 * robots.txt as crawlers read it (RFC 9309):
 *
 * - A crawler obeys the group naming its user-agent token (case doesn't
 *   matter; several groups for the same token are merged). Only when no
 *   group names it does it fall back to the "*" group.
 * - Within the group, the rule with the longest matching path wins; on a
 *   tie, Allow wins. "*" matches any characters and "$" ends the path.
 * - No robots.txt (4xx) means everything is allowed. One that can't be
 *   fetched (5xx, timeout) means everything is disallowed, until it can be.
 */

export type Rule = { allow: boolean; path: string };
export type Robots = { groups: { agents: string[]; rules: Rule[] }[]; sitemaps: string[] };

export function parseRobots(text: string): Robots {
  const groups: Robots["groups"] = [];
  const sitemaps: string[] = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n|\r/)) {
    const line = raw.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "user-agent") {
      // consecutive user-agent lines share one group
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (key === "allow" || key === "disallow") {
      lastWasAgent = false;
      // an empty Disallow allows everything: no rule needed
      if (current && value) current.rules.push({ allow: key === "allow", path: value });
    } else if (key === "sitemap") {
      if (value) sitemaps.push(value);
    } else {
      lastWasAgent = false;
    }
  }
  return { groups, sitemaps };
}

/** The rules a crawler follows: its own groups, or else the "*" groups. */
export function rulesFor(robots: Robots, agent: string): Rule[] | null {
  const token = agent.toLowerCase();
  const own = robots.groups.filter((g) => g.agents.includes(token));
  const chosen = own.length ? own : robots.groups.filter((g) => g.agents.includes("*"));
  return chosen.length ? chosen.flatMap((g) => g.rules) : null;
}

function patternLength(path: string) {
  return path.replace(/\$$/, "").length;
}

/** Does a robots.txt path pattern match a URL path (with its query)? */
export function pathMatches(pattern: string, path: string) {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${re}${anchored ? "$" : ""}`).test(path);
}

export type Verdict = {
  allowed: boolean;
  /** the rule that decided it; null when none matched (allowed by default) */
  rule: Rule | null;
  /** which group applied: the crawler's own, or "*" */
  group: "own" | "*" | "none";
};

export function verdict(robots: Robots, agent: string, path: string): Verdict {
  const token = agent.toLowerCase();
  const own = robots.groups.some((g) => g.agents.includes(token));
  const rules = rulesFor(robots, agent);
  if (!rules) return { allowed: true, rule: null, group: "none" };
  let best: Rule | null = null;
  for (const r of rules) {
    if (!pathMatches(r.path, path)) continue;
    if (
      !best ||
      patternLength(r.path) > patternLength(best.path) ||
      (patternLength(r.path) === patternLength(best.path) && r.allow && !best.allow)
    )
      best = r;
  }
  return { allowed: best ? best.allow : true, rule: best, group: own ? "own" : "*" };
}

/** robots.txt as fetched: found, missing (everything allowed) or unreachable (everything blocked). */
export type RobotsFile =
  | { state: "found"; robots: Robots }
  | { state: "missing" }
  | { state: "unreachable"; status: number | null };

export function verdictFor(file: RobotsFile, agent: string, path: string): Verdict {
  if (file.state === "missing") return { allowed: true, rule: null, group: "none" };
  if (file.state === "unreachable")
    return { allowed: false, rule: { allow: false, path: "/" }, group: "none" };
  return verdict(file.robots, agent, path);
}
