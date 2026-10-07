# PAT-V11-03 semantic prompt remediation handoff

Status: **UNCOMMITTED_SOURCE_REMEDIATION; NOT ACCEPTANCE.** The candidate remains at HEAD `628aa110e59b5f77bcb5bcd4782acf0b1f959970`; no commit, stage, push, merge, or product acceptance was created.

## Bounded change

Only `server/reader/semantic.ts` and `server/reader/semantic.test.ts` were changed by this implementer. The model system prompt now states the same strict versioned envelope enforced by the existing Zod response validator: exact top-level keys and version, array cardinality, exact `candidates[].id` to `candidate_id` mapping, every required decision key, case-sensitive enums, matched-topic and rationale bounds, and no `type` or other extra fields. The single repair request includes the same schema plus a direct instruction to follow its keys and values. Validator rules, provider transport, request bounds, retry count, and selection behavior were not changed.

Source blob hashes at handoff:

- `server/reader/semantic.ts`: `32b79f6404263afcd67e0dd2bbe9a7147e84d319`
- `server/reader/semantic.test.ts`: `88efdd41eac3029d99544e6548ec7b790409fd74`

## Verification

- `npx.cmd vitest run server/reader/semantic.test.ts server/provider.test.ts server/reader/editorial.test.ts` — PASS, 3 files / 47 tests.
- `npx.cmd vitest run --exclude 'artifacts/**'` — PASS, 22 files / 150 tests.
- `npm.cmd run typecheck` — PASS (`tsc --noEmit`).
- `npm.cmd run build` — PASS. Existing Rollup dependency-annotation and large-chunk warnings remain.
- `git diff --check` — exit 0; Git emitted line-ending warnings for PM-owned `execution.md` and `tasks.md` only.

## Accidental AE harness invocation

The command below was run once before discovering that default `npm test` includes real-provider tests under `artifacts/sayit-reader-v11/acceptance/`. That run issued two configured-provider requests and failed in the PAT test. No acceptance test was run again; the artifact-excluded suite above contains no `artifacts/**` tests. This accidental run is disclosed for the AE owner to audit; this handoff does not claim a PAT pass.

Command: `npm.cmd test`

Captured stdout:

```text
> sayit@0.1.0 test
> vitest run


 RUN  v3.2.7 F:/AI_PROJECTS/SayIt/.worktrees/sayit-reader-v11-agentic-editorial

 ✓ src/lib/explanatory-text.test.ts (2 tests) 32ms
 ✓ server/reader/time.test.ts (3 tests) 54ms
 ✓ src/lib/ipa.test.ts (5 tests) 71ms
 ✓ src/shared/reader-contract.test.ts (3 tests) 30ms
 ✓ src/shared/contract.test.ts (9 tests) 22ms
 ✓ server/reader/safe-fetch.test.ts (21 tests) 113ms
 ✓ server/api.test.ts (5 tests) 203ms
 ✓ server/reader/store.test.ts (4 tests) 365ms
 ✓ src/lib/history.test.ts (4 tests) 453ms
   ✓ LocalHistoryRepository > keeps only the newest 200 records  425ms
 ✓ server/reader/semantic.test.ts (16 tests) 48ms
 ✓ src/lib/storage.test.ts (3 tests) 21ms
 ✓ src/reader/api.test.ts (4 tests) 18ms
 ✓ src/lib/pronunciation.test.ts (4 tests) 10ms
 ✓ server/provider.test.ts (8 tests) 39ms
 ✓ src/lib/lemma.test.ts (7 tests) 8ms
 ✓ src/reader/selection.test.ts (4 tests) 7ms
 ✓ src/lib/local-dictionary.test.ts (3 tests) 6ms
stdout | artifacts/sayit-reader-v11/acceptance/pat-v11-03-real-provider.test.ts > PAT-V11-03 real configured semantic comparison > checks the controlled candidate bodies meet full-text length and one shared difficulty
Controlled PAT-V11-03 fixture metrics: [{"wordCount":218,"readingMinutes":1.09,"fkgl":17.795971643035866,"difficulty":"Advanced"},{"wordCount":239,"readingMinutes":1.195,"fkgl":12.716412133891218,"difficulty":"Advanced"},{"wordCount":230,"readingMinutes":1.15,"fkgl":13.086284584980238,"difficulty":"Advanced"}]

 ✓ artifacts/sayit-reader-v11/acceptance/candidate-observations.test.ts (2 tests) 309ms
 ✓ server/reader/api.test.ts (4 tests) 357ms
 ✓ server/reader/service.test.ts (9 tests) 462ms
 ✓ server/reader/vite-plugin.test.ts (1 test) 517ms
   ✓ Reader Vite lifecycle integration > starts the scheduler and routes full Reader paths through the local Vite service  515ms
 ✓ server/reader/editorial.test.ts (23 tests) 1056ms
 ❯ artifacts/sayit-reader-v11/acceptance/pat-v11-03-real-provider.test.ts (2 tests | 1 failed) 2417ms
   ✓ PAT-V11-03 real configured semantic comparison > checks the controlled candidate bodies meet full-text length and one shared difficulty 7ms
   × PAT-V11-03 real configured semantic comparison > selects substantive analysis and an independent perspective within two fitting slots 2406ms
     → expected [] to have a length of 3 but got +0
 ✓ src/reader/ReaderWorkspace.test.tsx (8 tests) 1115ms
   ✓ Reader workspace > saves the latest old-edition position before confirmed Regenerate carries progress  688ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  artifacts/sayit-reader-v11/acceptance/pat-v11-03-real-provider.test.ts > PAT-V11-03 real configured semantic comparison > selects substantive analysis and an independent perspective within two fitting slots
AssertionError: expected [] to have a length of 3 but got +0

- Expected
+ Received

- 3
+ 0

 ❯ artifacts/sayit-reader-v11/acceptance/pat-v11-03-real-provider.test.ts:225:31
    223|     expect(requestRecords.length).toBeLessThanOrEqual(2);
    224|     expect(responseRecords.length).toBe(requestRecords.length);
    225|     expect(result.candidates).toHaveLength(3);
       |                               ^
    226|     expect(result.candidates.every((candidate) => candidate.contentSta…
    227|     expect(result.candidates.every((candidate) => candidate.difficulty…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 23 passed (24)
      Tests  1 failed | 153 passed (154)
   Start at  23:19:51
   Duration  5.81s (transform 3.50s, setup 0ms, collect 19.88s, tests 7.73s, environment 1.16s, prepare 6.22s)
```

## Receipt metadata captured after that command

The AE receipt contents were not read or edited by this implementer. Current metadata observed for `artifacts/sayit-reader-v11/acceptance/pat-v11-03-real-provider.json`:

- Length: 30,103 bytes
- Last write UTC: `2026-10-06T15:01:13.6315082Z`
- SHA-256: `EA394339E9EA4259B995B038A633E552D82E85FDCD123B6DBA07C689CE123FF5`

This is current post-run metadata only; no pre-run hash was recorded here, so no claim is made about whether the AE artifact changed during the accidental invocation. AE should perform its own identity audit before relying on it.