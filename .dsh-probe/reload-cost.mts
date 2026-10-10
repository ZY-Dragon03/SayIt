// Measure what a request-path reload actually costs.
import { ReaderStore } from "./server/reader/store.ts";

const store = new ReaderStore({});
await store.initialize();
const timings: number[] = [];
for (let index = 0; index < 12; index += 1) {
  const started = performance.now();
  await store.reload();
  timings.push(performance.now() - started);
}
const snapshotStarted = performance.now();
const state = store.snapshot();
const snapshotMs = performance.now() - snapshotStarted;
store.close();
console.log(
  JSON.stringify({
    reloadMs: timings.map((value) => Math.round(value)),
    snapshotMs: Math.round(snapshotMs),
    attempts: state.attempts.length,
    traces: state.traces.length,
  }),
);
