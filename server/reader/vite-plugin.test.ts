import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { createServer } from "vite";
import { afterEach, describe, expect, it } from "vitest";
import { ReaderService } from "./service";
import { ReaderStore } from "./store";
import { readerServicePlugin } from "./vite-plugin";

describe("Reader Vite lifecycle integration", () => {
  let directory: string | null = null;
  let vite: Awaited<ReturnType<typeof createServer>> | null = null;
  let viteListening = false;
  let service: ReaderService | null = null;

  afterEach(async () => {
    if (vite && viteListening) await vite.close();
    vite = null;
    viteListening = false;
    await service?.stop();
    service = null;
    if (directory) await rm(directory, { recursive: true, force: true });
    directory = null;
  });

  it("starts the scheduler and routes full Reader paths through the local Vite service", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "sayit-reader-vite-"));
    const now = new Date("2026-10-04T08:00:00.000Z");
    let discoveryCalls = 0;
    let timerClearCount = 0;
    const store = new ReaderStore({ directory, now: () => now });
    await store.initialize();
    await store.update((state) => {
      state.preferences = {
        topics: ["Technology"],
        dailyArticleCount: 1,
        difficulty: "Intermediate",
        readingBudgetMinutes: 20,
        collectionTime: "18:00",
        timezone: "Asia/Shanghai",
      };
      state.preferencesConfigured = true;
    });
    service = new ReaderService({
      store,
      now: () => now,
      collect: async () => {
        discoveryCalls += 1;
        return {
          status: "NOT_DELIVERED",
          articles: [],
          candidates: [],
          actual: { count: 0, topics: [], difficulty: null, readingMinutes: 0 },
          unmetConstraints: ["No eligible article was found."],
          trace: { queries: [], candidates: [], decisions: [] },
        };
      },
      setTimer: (callback, delay) => setTimeout(callback, delay),
      clearTimer: (timer) => {
        timerClearCount += 1;
        clearTimeout(timer);
      },
    });
    const port = await availableLoopbackPort();
    vite = await createServer({
      configFile: false,
      appType: "custom",
      logLevel: "silent",
      plugins: [readerServicePlugin({ service, enableProxy: () => () => undefined })],
      server: { host: "127.0.0.1", port, strictPort: true },
    });
    await vite.listen();
    viteListening = true;

    const address = vite.httpServer?.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const preferencesResponse = await fetch(`${baseUrl}/api/reader/preferences`);
    const preferencesPayload = await preferencesResponse.json();
    expect(preferencesResponse.status).toBe(200);
    expect(preferencesPayload.schema_version).toBe("1");
    expect(preferencesPayload.preferences.topics).toEqual(["Technology"]);

    const todayResponse = await fetch(`${baseUrl}/api/reader/issues/today`);
    const todayPayload = await todayResponse.json();
    expect(todayResponse.status).toBe(200);
    expect(todayPayload.occurrence.status).toBe("WAITING");
    expect(todayPayload.attempts).toHaveLength(0);
    expect(discoveryCalls).toBe(0);

    const missingResponse = await fetch(`${baseUrl}/api/reader/missing`);
    expect(missingResponse.status).toBe(404);
    expect((await missingResponse.json()).schema_version).toBe("1");

    await vite.close();
    vite = null;
    expect(timerClearCount).toBeGreaterThan(0);
  });
});

async function availableLoopbackPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close();
        reject(new Error("Could not reserve a local test port."));
        return;
      }
      const port = (address as AddressInfo).port;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
