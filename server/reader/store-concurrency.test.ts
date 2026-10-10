/**
 * Cross-process write serialization for the Reader store.
 *
 * `node:sqlite` is synchronous, so two writers in one process cannot genuinely
 * overlap: the first call blocks the thread. Real concurrency therefore has to
 * come from separate processes, which is exactly how the development server and
 * the Windows scheduled task share this state.
 *
 * The worker below is the same critical section `ReaderStore.update()` runs —
 * `BEGIN IMMEDIATE`, read, mutate, `COMMIT` — driven through several independent
 * processes at once. If the store had kept using a read-then-rewrite file, every
 * writer but the last would be lost here.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);
const WORKERS = 4;
const ROUNDS = 25;

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 5 }),
    ),
  );
});

const workerSource = `
const { DatabaseSync } = require("node:sqlite");
const [mode, worker, databaseFile] = process.argv.slice(2);
const database = new DatabaseSync(databaseFile);
// Switching journal mode needs an exclusive lock and is not covered by
// busy_timeout, so the database is put into WAL once before writers contend —
// exactly the order ReaderStore uses when it creates its own database.
if (mode === "setup") {
  database.exec("PRAGMA busy_timeout = 60000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, worker TEXT NOT NULL)");
} else {
  database.exec("PRAGMA busy_timeout = 60000");
  // First start: the table may not exist yet because a peer is still creating
  // it. Retry the same way the store retries its own WAL switch, so this tests
  // initialization under contention rather than assuming it already happened.
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      database.exec("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, worker TEXT NOT NULL)");
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}
let committed = 0;
for (let round = 0; mode !== "setup" && round < ${ROUNDS}; round += 1) {
  database.exec("BEGIN IMMEDIATE");
  try {
    // Read the committed set, then add this worker's record: the same
    // read-modify-commit shape as ReaderStore.update().
    database.prepare("SELECT id FROM records").all();
    database
      .prepare("INSERT OR REPLACE INTO records (id, worker) VALUES (?, ?)")
      .run(worker + "-" + round, worker);
    database.exec("COMMIT");
    committed += 1;
  } catch (error) {
    try { database.exec("ROLLBACK"); } catch {}
    process.stderr.write("worker " + worker + " failed: " + error.message + "\\n");
    process.exitCode = 1;
    break;
  }
}
if (mode !== "setup") process.stdout.write(worker + " committed=" + committed + "\\n");
database.close();
`;

/** Put the shared database into WAL once, then start every writer against it. */
async function prepareDatabase(workerScript: string, databaseFile: string) {
  await run(process.execPath, [workerScript, "setup", "setup", databaseFile]);
}

async function runWorkers(
  workerScript: string,
  databaseFile: string,
  prefix: string,
): Promise<{ stdout: string; stderr: string }[]> {
  return Promise.all(
    Array.from({ length: WORKERS }, (_, index) =>
      run(process.execPath, [workerScript, prefix, `${prefix}${index}`, databaseFile]).catch(
        (error: { stdout?: string; stderr?: string; message: string }) => ({
          stdout: error.stdout ?? "",
          stderr: `${error.message}\n${error.stderr ?? ""}`,
        }),
      ),
    ),
  );
}

describe("Reader store cross-process integrity", () => {
  it("loses no committed record when independent processes write the same state at once", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sayit-reader-concurrency-"));
    directories.push(directory);
    const databaseFile = path.join(directory, "reader-state.db");
    const workerScript = path.join(directory, "worker.cjs");
    await writeFile(workerScript, workerSource, "utf8");

    await prepareDatabase(workerScript, databaseFile);
    const results = await runWorkers(workerScript, databaseFile, "w");

    for (const result of results) {
      // Report the worker's own diagnosis when one could not commit.
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`committed=${ROUNDS}`);
    }

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databaseFile);
    const total = database.prepare("SELECT COUNT(*) AS n FROM records").get() as {
      n: number;
    };
    const perWorker = database
      .prepare("SELECT worker, COUNT(*) AS n FROM records GROUP BY worker ORDER BY worker")
      .all() as { worker: string; n: number }[];
    const journal = database.prepare("PRAGMA journal_mode").get() as {
      journal_mode: string;
    };
    database.close();

    // Every write from every process is present: nothing was overwritten.
    expect(total.n).toBe(WORKERS * ROUNDS);
    expect(perWorker).toHaveLength(WORKERS);
    for (const row of perWorker) expect(row.n).toBe(ROUNDS);
    expect(journal.journal_mode).toBe("wal");
  }, 60_000);

  it("initializes without losing a writer when two processes open a brand-new state file at once", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sayit-reader-concurrency-"));
    directories.push(directory);
    const databaseFile = path.join(directory, "reader-state.db");
    const workerScript = path.join(directory, "worker.cjs");
    await writeFile(workerScript, workerSource, "utf8");

    // No setup run: both processes race to create the database and switch it to
    // WAL, which is the first-start race the busy-timeout ordering must survive.
    const results = await runWorkers(workerScript, databaseFile, "cold");
    for (const result of results) {
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain(`committed=${ROUNDS}`);
    }

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databaseFile);
    const total = database.prepare("SELECT COUNT(*) AS n FROM records").get() as {
      n: number;
    };
    database.close();
    expect(total.n).toBe(WORKERS * ROUNDS);
  }, 60_000);

  it("keeps its own writes when another process writes too", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sayit-reader-concurrency-"));
    directories.push(directory);
    const databaseFile = path.join(directory, "reader-state.db");
    const workerScript = path.join(directory, "worker.cjs");
    await writeFile(workerScript, workerSource, "utf8");

    await prepareDatabase(workerScript, databaseFile);
    await runWorkers(workerScript, databaseFile, "p");

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databaseFile);
    const integrity = database.prepare("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    database.close();
    expect(Object.values(integrity)[0]).toBe("ok");
  }, 60_000);

  it("survives a writer that is killed mid-transaction", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "sayit-reader-concurrency-"));
    directories.push(directory);
    const databaseFile = path.join(directory, "reader-state.db");
    const crashing = path.join(directory, "crash.cjs");
    await writeFile(
      crashing,
      `
const { DatabaseSync } = require("node:sqlite");
const database = new DatabaseSync(process.argv[2]);
database.exec("PRAGMA journal_mode = WAL");
database.exec("PRAGMA busy_timeout = 60000");
database.exec("CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, worker TEXT NOT NULL)");
database.exec("BEGIN IMMEDIATE");
database.prepare("INSERT INTO records (id, worker) VALUES ('torn', 'crash')").run();
// Exit without COMMIT: the transaction must never be visible.
process.exit(9);
`,
      "utf8",
    );
    await expect(
      run(process.execPath, [crashing, databaseFile]),
    ).rejects.toMatchObject({ code: 9 });

    const workerScript = path.join(directory, "worker.cjs");
    await writeFile(workerScript, workerSource, "utf8");
    await prepareDatabase(workerScript, databaseFile);
    const recovered = await runWorkers(workerScript, databaseFile, "after");
    for (const result of recovered) expect(result.stderr).toBe("");

    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(databaseFile);
    const torn = database
      .prepare("SELECT COUNT(*) AS n FROM records WHERE id = 'torn'")
      .get() as { n: number };
    const written = database
      .prepare(
        "SELECT worker, COUNT(*) AS n FROM records WHERE worker <> 'crash' GROUP BY worker",
      )
      .all() as { worker: string; n: number }[];
    database.close();
    // The interrupted transaction left nothing behind, and the writers that ran
    // afterwards still committed every one of their records.
    expect(torn.n).toBe(0);
    expect(written).toHaveLength(WORKERS);
    for (const row of written) expect(row.n).toBe(ROUNDS);
  }, 60_000);
});
