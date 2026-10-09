/**
 * The Reader scheduler decision that runs once per invocation.
 *
 * Windows Task Scheduler calls this every few minutes. Each run is a bounded,
 * idempotent decision:
 *
 *   - an issue already COMPLETE moves its occurrence to ALREADY_FULFILLED;
 *   - a collection that is already RUNNING (the user pressed Collect now, or an
 *     earlier invocation is still working) is never started twice;
 *   - a retry that is not due yet keeps its scheduled time;
 *   - an occurrence left RUNNING by a crashed process is recovered first;
 *   - an overdue date is collected, and a date that already passed without
 *     delivery stays EXHAUSTED instead of being silently retried forever.
 *
 * Every invocation appends one line to `scheduler.log` next to the Reader state,
 * so a missed or crashed schedule leaves evidence instead of disappearing.
 *
 * Flags:
 *   --timeout-ms N        hard wall-clock bound for this invocation
 *   --json                machine-readable single-line summary
 *   --backfill YYYY-MM-DD recover one earlier, unfulfilled issue
 */
import { appendFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "vite";
import { createDeepSeekJsonCompletionClient } from "../provider";
import { ReaderService } from "./service";
import { defaultReaderDirectory } from "./store";

interface Options {
  timeoutMs: number;
  json: boolean;
  backfill: string | null;
}

const DEFAULT_TIMEOUT_MS = 12 * 60_000;

function parseArgs(argv: string[]): Options {
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let json = false;
  let backfill: string | null = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--timeout-ms") {
      const value = Number(argv[index + 1]);
      if (Number.isFinite(value) && value > 0) timeoutMs = value;
      index += 1;
    } else if (arg === "--json") {
      json = true;
    } else if (arg === "--backfill") {
      const value = argv[index + 1];
      if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) backfill = value;
      index += 1;
    }
  }
  return { timeoutMs, json, backfill };
}

function createService(): ReaderService {
  const env = loadEnv("development", process.cwd(), "");
  const config = {
    apiKey: env.DEEPSEEK_API_KEY ?? process.env.DEEPSEEK_API_KEY,
    model: env.DEEPSEEK_MODEL ?? process.env.DEEPSEEK_MODEL,
    baseUrl: env.DEEPSEEK_BASE_URL ?? process.env.DEEPSEEK_BASE_URL,
  };
  return new ReaderService({
    // This process is the single owner of scheduled runs.
    scheduleRuns: true,
    semanticClient: createDeepSeekJsonCompletionClient(config),
  });
}

async function record(line: string): Promise<void> {
  try {
    await appendFile(
      path.join(defaultReaderDirectory(), "scheduler.log"),
      `${line}\n`,
      "utf8",
    );
  } catch {
    // Logging is evidence, never a reason to fail a collection run.
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const service = createService();

  const guard = setTimeout(() => {
    const message = `[reader-scheduler] timed out after ${options.timeoutMs}ms`;
    process.stderr.write(`${message}\n`);
    void record(`${new Date().toISOString()} TIMEOUT ${options.timeoutMs}ms`);
    process.exit(2);
  }, options.timeoutMs);
  guard.unref?.();

  let summary: Record<string, unknown>;
  try {
    await service.start();
    if (options.backfill) {
      summary = { mode: "backfill", date: options.backfill };
      const outcome = await service.backfillIssue(options.backfill);
      await service.waitForIdle();
      Object.assign(summary, outcome);
    } else {
      await service.waitForIdle();
      summary = { mode: "scheduled-check", ...service.todayDecision() };
    }
  } catch (error) {
    clearTimeout(guard);
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[reader-scheduler] failed: ${message}\n`);
    await record(`${new Date().toISOString()} ERROR ${JSON.stringify(message)}`);
    process.exit(1);
  }
  clearTimeout(guard);
  await service.stop();

  const payload: Record<string, unknown> = {
    at: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    ...summary,
  };
  const line = options.json
    ? JSON.stringify(payload)
    : Object.entries(payload)
        .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
        .join(" ");
  process.stdout.write(`[reader-scheduler] ${line}\n`);
  await record(`${new Date().toISOString()} ${line}`);

  const failed =
    typeof payload.lastAttemptState === "string" &&
    payload.lastAttemptState === "FAILED";
  process.exit(failed ? 1 : 0);
}

void main();
