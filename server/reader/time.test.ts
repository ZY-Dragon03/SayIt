import { describe, expect, it } from "vitest";
import { localDateTime, resolveScheduledTime } from "./time";

describe("Reader schedule wall-time resolution", () => {
  it("moves a skipped DST minute to the first valid local minute", () => {
    const instant = resolveScheduledTime(
      "2026-03-08",
      "02:30",
      "America/New_York",
    );

    expect(instant.toISOString()).toBe("2026-03-08T07:00:00.000Z");
    expect(localDateTime(instant, "America/New_York").time).toBe("03:00");
  });

  it("uses the first instant for a repeated DST minute", () => {
    const instant = resolveScheduledTime(
      "2026-11-01",
      "01:30",
      "America/New_York",
    );

    expect(instant.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("rejects impossible calendar dates rather than normalizing them", () => {
    expect(() =>
      resolveScheduledTime("2026-02-30", "08:00", "Asia/Shanghai"),
    ).toThrow("Invalid local date or time.");
  });
});
