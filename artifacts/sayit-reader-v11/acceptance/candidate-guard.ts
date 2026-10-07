import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const EXPECTED_CANDIDATE_COMMIT = "a33e7ff1a881551ade59b37e38da24fca05a7dc4";
export const EXPECTED_CANDIDATE_TREE = "bb9175405b17741114f2a1e86e393891487f46b1";

const ALLOWED_DIRTY_FILES = new Set([
  "openspec/changes/agentic-editorial-curation-dynamic-source-trust/execution.md",
  "openspec/changes/agentic-editorial-curation-dynamic-source-trust/tasks.md",
  "artifacts/sayit-reader-v11/engineering/pat-v11-03-semantic-prompt-remediation.md",
]);
const ALLOWED_DIRTY_PREFIXES = ["artifacts/sayit-reader-v11/acceptance/"];

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trimEnd();
}

function isAllowedDirtyPath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return ALLOWED_DIRTY_FILES.has(normalized) || ALLOWED_DIRTY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function assertFrozenCandidate(): { commit: string; tree: string } {
  const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  const commit = git(["rev-parse", "HEAD"], candidateRoot);
  const tree = git(["rev-parse", "HEAD^{tree}"], candidateRoot);
  if (commit !== EXPECTED_CANDIDATE_COMMIT || tree !== EXPECTED_CANDIDATE_TREE) {
    throw new Error(`Acceptance candidate identity mismatch: ${commit}/${tree}.`);
  }

  const status = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"], candidateRoot);
  const rejectedPaths: string[] = [];
  for (const record of status.split("\0").filter(Boolean)) {
    const changeKind = record.slice(0, 2);
    const relativePath = record.slice(3);
    if (changeKind.includes("R") || changeKind.includes("C") || !isAllowedDirtyPath(relativePath)) {
      rejectedPaths.push(relativePath || record);
    }
  }
  if (rejectedPaths.length > 0) {
    throw new Error(`Acceptance candidate has unapproved dirty product paths: ${rejectedPaths.join(", ")}.`);
  }

  return { commit, tree };
}
