import { describe, expect, it } from "vitest";
import {
  describeSchedule,
  nextRunAt,
  parseTimeOfDay,
  validateSchedule,
  zonedTime,
  type Schedule,
} from "./schedule-rules";

const s = (over: Partial<Schedule>): Schedule => ({
  frequency: "daily",
  minute: 9 * 60,
  weekday: 1,
  timezone: "UTC",
  ...over,
});

describe("nextRunAt", () => {
  it("is null when off", () => {
    expect(nextRunAt(s({ frequency: "off" }), new Date())).toBeNull();
  });

  it("daily: later today, or tomorrow once the time has passed", () => {
    const sched = s({});
    expect(nextRunAt(sched, new Date("2026-10-20T08:00:00Z"))).toEqual(
      new Date("2026-10-20T09:00:00Z"),
    );
    expect(nextRunAt(sched, new Date("2026-10-20T09:00:00Z"))).toEqual(
      new Date("2026-10-21T09:00:00Z"),
    );
  });

  it("uses the schedule's timezone", () => {
    // 09:00 in Kolkata (UTC+5:30) is 03:30 UTC
    expect(nextRunAt(s({ timezone: "Asia/Kolkata" }), new Date("2026-10-20T00:00:00Z"))).toEqual(
      new Date("2026-10-20T03:30:00Z"),
    );
  });

  it("keeps the local time across a clock change", () => {
    // London leaves summer time on 25 Oct 2026: 09:00 is 08:00 UTC before, 09:00 UTC after
    const sched = s({ timezone: "Europe/London" });
    expect(nextRunAt(sched, new Date("2026-10-24T12:00:00Z"))).toEqual(
      new Date("2026-10-25T09:00:00Z"),
    );
    expect(nextRunAt(sched, new Date("2026-10-23T12:00:00Z"))).toEqual(
      new Date("2026-10-24T08:00:00Z"),
    );
  });

  it("weekly: the next matching weekday, across a month end", () => {
    // Fri 30 Oct 2026; next Monday is 2 Nov
    expect(
      nextRunAt(s({ frequency: "weekly", weekday: 1 }), new Date("2026-10-30T12:00:00Z")),
    ).toEqual(new Date("2026-11-02T09:00:00Z"));
    // a Monday after 09:00: a week later
    expect(
      nextRunAt(s({ frequency: "weekly", weekday: 1 }), new Date("2026-10-19T10:00:00Z")),
    ).toEqual(new Date("2026-10-26T09:00:00Z"));
  });

  it("weekly in a timezone ahead of UTC uses the local day", () => {
    // Mon 07:00 in Tokyo is Sun 22:00 UTC
    expect(
      nextRunAt(
        s({ frequency: "weekly", weekday: 1, minute: 7 * 60, timezone: "Asia/Tokyo" }),
        new Date("2026-10-25T12:00:00Z"),
      ),
    ).toEqual(new Date("2026-10-25T22:00:00Z"));
  });
});

describe("helpers", () => {
  it("zonedTime turns a wall-clock time into an instant", () => {
    expect(zonedTime("America/New_York", 2026, 7, 1, 12 * 60)).toEqual(
      new Date("2026-07-01T16:00:00Z"),
    );
  });

  it("validates", () => {
    expect(validateSchedule(s({}))).toBeNull();
    expect(validateSchedule(s({ minute: 1440 }))).toMatch(/time/);
    expect(validateSchedule(s({ weekday: 7 }))).toMatch(/day/);
    expect(validateSchedule(s({ timezone: "Mars/Olympus" }))).toMatch(/timezone/);
  });

  it("parses and describes times", () => {
    expect(parseTimeOfDay("07:05")).toBe(425);
    expect(parseTimeOfDay("24:00")).toBeNull();
    expect(describeSchedule(s({ frequency: "weekly", weekday: 3 }))).toBe(
      "Every Wednesday at 09:00 (UTC)",
    );
  });
});
