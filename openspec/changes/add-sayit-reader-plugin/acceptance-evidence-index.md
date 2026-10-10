# SayIt Reader Acceptance Evidence Index

> Convergence record. The frozen plan in `acceptance-plan.md` and the 49 PAT cases are unchanged.
> This file only records what happened to the candidate-bound evidence that used to live on the
> retired `evidence/*` branches, so those branches did not have to be kept.

## Where live evidence belongs

Candidate-bound acceptance results belong in `artifacts/product-acceptance/reader/`, bound to one
integrated candidate SHA per round (`acceptance-plan.md`, "Candidate and evidence rules"). That
directory is recreated by a new round; nothing there is currently published from a live round.

## Retired branches

Two branches held evidence-only commits. Neither contained an alternative production implementation.

| Branch | Unique commits | Tracked `artifacts/product-acceptance/` files |
| --- | ---: | ---: |
| `evidence/sayit-reader-candidate-75774b3` | 3 | 89 |
| `evidence/sayit-reader-candidate-f449ef6` | 2 | 13 (a subset of the 89) |

Their raw output was per-round run dumps, per-case logs, Python/shell/MJS harness scripts and
compiled `__pycache__` bytecode. Those files are generated evidence bound to the two candidate trees
below and are only reproducible against those trees, so they are retired rather than imported. The
adjudicated conclusions are preserved in this file.

## Preserved adjudication

### Candidate `f449ef6` — 17-case triage

- SHA `f449ef625f171b8cb1dc836efdba6821f1681c9b`, tree `edbd171affd6142249ec7317bd55e109e7c59f04`.
- Aggregate: 11 PASS, 1 FAIL, 4 PARTIAL, 1 NOT-RUN of 17. `product_accepted: false`.
- Per case: PAT-RC-25 PARTIAL · PAT-RC-26 PASS · PAT-RH-01 PASS · PAT-RH-02 PASS · PAT-RH-03 PASS ·
  PAT-RH-04 PASS · PAT-RH-05 PASS · PAT-RH-06 NOT-RUN · PAT-RH-07 PASS · PAT-RH-08 PARTIAL ·
  PAT-RH-09 FAIL · PAT-RH-10 PASS · PAT-RH-11 PARTIAL · PAT-RH-12 PARTIAL · PAT-RH-13 PASS ·
  PAT-RH-14 PASS · PAT-RH-15 PASS.
- Open finding carried forward: PAT-RH-09, publisher article body boundary.

### Candidate `75774b3` — 17-case adjudication matrix

- SHA `75774b368296b21b11e2c10c1de05190cab3210c`, tree `40816d7a180ab1c5269fff7ee4f771006ba144ac`.
- Aggregate: 17 PASS, 0 FAIL, 0 NOT-RUN of 17. `product_accepted: false`.
- 11 predecessor PASS rows were carried forward under an unchanged-surface rule — the delta from
  `f449ef6` touched only the publisher body-root selection in `server/reader/editorial.ts` — and
  PAT-RH-09 was re-observed live instead of carried forward.

### Candidate `f885b39` — interim 49-case report

- `report_status: COMPLETE_NOT_ACCEPTED`; 20 PASS, 1 FAIL, 28 NOT-RUN of 49.
- Recorded reason: "PAT-RH-10 failed; 28 cases remain NOT-RUN."

Neither candidate was ever declared product-accepted, so no retired branch was a competing line of
development and none needed to be merged over `main`.

## Where each finding is closed

Every behavior those rounds raised is already closed in `main` by commits whose messages name it:

| Behavior raised by the review rounds | Commit in `main` |
| --- | --- |
| Publisher article body boundary / verified article roots | `75774b3`, `f449ef6`, `dfaec69` |
| Incomplete readability extraction rejected | `abdbad5` |
| Editorial topic and hub index pages rejected | `d8669b3`, `f885b39` |
| Full text gated by editorial source | `e5e6ea2` |
| Collection outage fails retryably | `53d2b2e` |
| Reading position restoration race | `f9a4b8f` |
| Progress captured after closing the article | `c7c2650` |
| Progress preserved across Regenerate | `07c1ecb` |
| Back control visible while reading | `3c50542` |

`main` has since advanced well beyond `75774b3`, so the matrices above are a historical record of the
pre-convergence candidates, not a claim about the current tree. Current behavior is covered by
`server/reader/*.test.ts` and `src/reader/*.test.tsx` on `main`.
