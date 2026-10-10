const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const db = new DatabaseSync(path.join(process.env.LOCALAPPDATA, "SayIt", "Reader", "reader-state.db"));
db.exec("PRAGMA busy_timeout = 10000");
const traces = db.prepare("SELECT payload FROM traces ORDER BY rowid").all().map((r) => JSON.parse(r.payload));
console.log("traces:", traces.length);
for (const t of traces) {
  const byOutcome = {};
  for (const c of t.candidates) byOutcome[c.outcome] = (byOutcome[c.outcome] ?? 0) + 1;
  console.log(`${t.createdAt} issue=${t.issueId} queries=${t.queries.length} candidates=${t.candidates.length} semantic=${t.semantic?.status ?? "n/a"} outcomes=${JSON.stringify(byOutcome)}`);
}
console.log("\n=== rejection taxonomy across all traces ===");
const reasons = new Map();
const pubs = new Map();
for (const t of traces) {
  for (const c of t.candidates) {
    if (c.outcome === "REJECTED") {
      const key = c.reason.replace(/^[\d]+ of [\d]+/, "N of M").slice(0, 72);
      reasons.set(key, (reasons.get(key) ?? 0) + 1);
    }
    const p = pubs.get(c.publication) ?? { total: 0, accepted: 0, rejected: 0, duplicate: 0, http: new Map() };
    p.total += 1;
    if (c.outcome === "ACCEPTED") p.accepted += 1;
    else if (c.outcome === "REJECTED") p.rejected += 1;
    else p.duplicate += 1;
    if (c.statusCode) p.http.set(c.statusCode, (p.http.get(c.statusCode) ?? 0) + 1);
    pubs.set(c.publication, p);
  }
}
for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`${String(count).padStart(4)}x  ${reason}`);
}
console.log("\n=== publishers (>=4 candidates) ===");
console.log("pub".padEnd(22), "cand", "ok", "rej", "dup", "http");
for (const [name, p] of [...pubs.entries()].sort((a, b) => b[1].total - a[1].total)) {
  if (p.total < 4) continue;
  console.log(name.padEnd(22), String(p.total).padStart(4), String(p.accepted).padStart(3), String(p.rejected).padStart(4), String(p.duplicate).padStart(4),
    JSON.stringify(Object.fromEntries(p.http)));
}
db.close();