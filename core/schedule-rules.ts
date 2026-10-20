/**
 * Schedules: when a workspace's runs start on their own. Pure functions, so
 * the Settings form and the worker agree on the next run. Times are local to
 * the schedule's timezone, so "09:00 daily" stays 09:00 across clock changes.
 */

export type Frequency = "off" | "daily" | "weekly";

export type Schedule = {
  frequency: Frequency;
  /** local time of day, in minutes after midnight */
  minute: number;
  /** for weekly runs: 0 Sunday … 6 Saturday */
  weekday: number;
  /** IANA name, e.g. Europe/London */
  timezone: string;
};

export const DEFAULT_SCHEDULE: Schedule = {
  frequency: "off",
  minute: 9 * 60,
  weekday: 1,
  timezone: "UTC",
};

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Runs a month at this frequency, for estimates. */
export const RUNS_PER_MONTH: Record<Frequency, number> = { off: 0, daily: 30, weekly: 4.35 };

export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function validateSchedule(s: Schedule): string | null {
  if (!["off", "daily", "weekly"].includes(s.frequency)) return "Pick off, daily or weekly.";
  if (!Number.isInteger(s.minute) || s.minute < 0 || s.minute >= 24 * 60)
    return "Pick a time of day.";
  if (!Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6)
    return "Pick a day of the week.";
  if (!isTimezone(s.timezone)) return `"${s.timezone}" isn't a timezone we know.`;
  return null;
}

type Local = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The wall-clock date and time in `tz` at instant `at`. */
export function localParts(at: Date, tz: string): Local {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      weekday: "short",
    });
    formatters.set(tz, f);
  }
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour),
    minute: Number(p.minute),
    weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(p.weekday),
  };
}

/** The instant when the wall clock in `tz` shows this date and time. */
export function zonedTime(
  tz: string,
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
): Date {
  const wanted = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  // start as if tz were UTC, then correct by the offset; twice covers DST edges
  let guess = wanted;
  for (let i = 0; i < 2; i++) {
    const l = localParts(new Date(guess), tz);
    const shown = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
    guess += wanted - shown;
  }
  return new Date(guess);
}

/** The first scheduled time strictly after `after`, or null when off. */
export function nextRunAt(s: Schedule, after: Date): Date | null {
  if (s.frequency === "off") return null;
  const today = localParts(after, s.timezone);
  for (let add = 0; add <= 8; add++) {
    // calendar arithmetic in UTC, so month ends roll over
    const d = new Date(Date.UTC(today.year, today.month - 1, today.day + add));
    if (s.frequency === "weekly" && d.getUTCDay() !== s.weekday) continue;
    const at = zonedTime(
      s.timezone,
      d.getUTCFullYear(),
      d.getUTCMonth() + 1,
      d.getUTCDate(),
      s.minute,
    );
    if (at > after) return at;
  }
  return null;
}

export const timeOfDay = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

export function parseTimeOfDay(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

/** "Every Monday at 09:00 (Europe/London)" */
export function describeSchedule(s: Schedule): string {
  if (s.frequency === "off") return "Off";
  const day = s.frequency === "daily" ? "Every day" : `Every ${WEEKDAYS[s.weekday]}`;
  return `${day} at ${timeOfDay(s.minute)} (${s.timezone})`;
}

/** "Tue 21 Oct, 09:00" in the schedule's timezone. */
export function formatInZone(at: Date, tz: string): string {
  return at.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
}
