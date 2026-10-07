# Acceptance harness containment

The acceptance observations are opt-in. Their files use the `.acceptance.ts` suffix and are excluded from Vitest's normal `.test.ts` / `.spec.ts` discovery. The root package and Vitest configuration were not changed.

Run the acceptance observations explicitly from the fixed candidate root only after remediation produces a new candidate and its identity is deliberately rebound in `candidate-guard.ts`:

```powershell
& .\node_modules\.bin\vitest.cmd run --config artifacts/sayit-reader-v11/acceptance/vitest.acceptance.config.ts
```

The acceptance config checks candidate commit/tree identity and rejects dirty product paths before discovering observations. It is now bound to commit `a33e7ff1a881551ade59b37e38da24fca05a7dc4` and tree `bb9175405b17741114f2a1e86e393891487f46b1`. It permits the PM-owned execution/tasks status documents, the V11.1 acceptance directory, and the current PM remediation note `artifacts/sayit-reader-v11/engineering/pat-v11-03-semantic-prompt-remediation.md`. The new candidate's source status was clean at handoff. No product or acceptance test has yet been run on this candidate.

## Receipt disposition

The instrumented failed V11-03 receipt is retained at `pat-v11-03-628aa110-tree-146b7a9f-instrumented-failure.json`. Its SHA-256 is `EA394339E9EA4259B995B038A633E552D82E85FDCD123B6DBA07C689CE123FF5`. It contains the two bounded DeepSeek request/response pairs and the candidate `INVALID_RESPONSE` trace. Its recorded modification time, `2026-10-06T15:01:13.6315082Z`, matches the instrumented run captured in this acceptance session; the repository was checked before that run with only PM execution/task documents and acceptance artifacts dirty.

The Implementer later reported a default `npm test` run that auto-discovered acceptance tests while semantic source/test files were dirty, failed `expected [] to have length 3`, and issued two provider requests. No distinct raw receipt for that dirty-source run is present in the acceptance directory or in the saved outputs available here. The current receipt content and modification time match the earlier instrumented failure, so it is preserved as that failure; it is not evidence for the reported dirty-source run. The latter run's raw requests, responses, and runtime trace are unavailable and are not reconstructed.
