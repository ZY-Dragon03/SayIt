import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync(new URL("./register-reader-task.ps1", import.meta.url), "utf8");

describe("Reader scheduled task registration", () => {
  it("launches the scheduler without Vite's development Reader service", () => {
    expect(script).toMatch(/\$arguments\s*=.*--mode production/);
  });

  it("creates an indefinitely repeating trigger anchored after registration", () => {
    const trigger = script.match(/\$trigger\s*=\s*New-ScheduledTaskTrigger([\s\S]*?)(?=\r?\n\$settings)/)?.[0] ?? "";

    expect(script).toMatch(/\$firstRun\s*=\s*\(Get-Date\)\.AddMinutes\(1\)/);
    expect(trigger).toContain("-Once");
    expect(trigger).toContain("-At $firstRun");
    expect(trigger).toContain("-RepetitionInterval");
    expect(trigger).not.toMatch(/-RepetitionDuration\b/);
  });
});
