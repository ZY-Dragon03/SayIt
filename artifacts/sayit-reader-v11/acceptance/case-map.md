# Initial case map (one-pass triage; superseded)

This map records the first triage against failed candidate `628aa110e59b5f77bcb5bcd4782acf0b1f959970`. Final statuses and evidence bind to the remediated candidate in [acceptance-report.md](acceptance-report.md); receipt hashes and commands are in [evidence-index.json](evidence-index.json).

Candidate: `628aa110e59b5f77bcb5bcd4782acf0b1f959970` / tree `146b7a9f0ea241b410a0be9209f6aa4f28de5303`.
Contract: `sayit-reader-v1.1-product-contract-r1`, aggregate SHA256 `5d58710e6fd10df211f69db4cbcd91f035a0a71a874d918aa013861f2769692d`.
Candidate HEAD matches. Working-tree dirt is limited to PM-owned `execution.md` and `tasks.md`.
The implementation handoff reports candidate-bound 150/150, 92/92, typecheck/build/diff-check PASS; it says 14 handoff source/test blob hashes were verified at integration. I reuse those results only where the assertions prove the frozen observation.

| Case | Existing candidate-bound evidence | Classification / exact remaining observation | Smallest next action |
|---|---|---|---|
| PAT-V11-01 | `server/reader/editorial.test.ts` unlisted InfoStream positive uses generated HTML, mock fetch and fixture semantic client. | PARTIAL; lacks an actual unknown-publisher article fetch and successful full-text/selection path. | Real preference-only collection; if it selects an unknown verified publisher, reuse for PAT-V11-06/01. |
| PAT-V11-02 | `editorial.test.ts` unknown-source canonical mismatch, missing identity, title conflict; summary/incomplete-body rejection paths. | PARTIAL; missing unknown publisher vs `og:site_name` conflict and exact reason/no semantic/no count. | Add/run one acceptance-only HTML fixture through candidate collector. |
| PAT-V11-03 | Semantic contract tests cover schema/bounds only; no real provider judgment. | NEW_RUN_REQUIRED; no real comparison of three verified article contents with competing keyword/repetition vs analysis and perspective. | Use three controlled verified articles and make one real bounded call through configured DeepSeek adapter; PAT-01/06 cover the separate live-source requirement. |
| PAT-V11-04 | `editorial.test.ts` “rejects repeated copies while allowing independent analysis of the same event” asserts two selected, duplicate excluded, source attribution and shingle threshold. | SUFFICIENT engineering observation. | None unless the real PAT-V11-03 flow also happens to prove it. |
| PAT-V11-05 | `semantic.test.ts` invalid version/IDs/enums/authority fields, one repair cap; `reader-contract.test.ts` rejects source/completion authority. | SUFFICIENT direct structural/security assertions. | None. |
| PAT-V11-06 | `editorial.test.ts` mock discovery proves queries omit `site:` and no URL list, but not real network or saved prefs. | NEW_RUN_REQUIRED; real broad search from saved prefs with no URL list, unknown source reaching verification/semantic decision. | Same real Vite Reader collection as PAT-V11-01. |
| PAT-V11-07 | `safe-fetch.test.ts` DNS/private/redirect/NO_PROXY/pinned-IP paths; semantic authority-field rejection. | SUFFICIENT direct assertions, source bound. | None. |
| PAT-V11-08 | `semantic.test.ts` config/provider/invalid/repair cases; `service.test.ts` failure trace, old issue/progress and retry bounds. | SUFFICIENT direct assertions. | None. |
| PAT-V11-09 | `store.test.ts` rationale/provenance restart plus legacy record; `api.test.ts` rationale retrieval through a restarted service. | PARTIAL; rationale must be from the actual real semantic delivery. | Reopen/restart same real PAT-V11-03/01 issue, compare rationale/version/decision/ID and legacy record. |
| PAT-V11-10 | `editorial.test.ts` complete constraint selection and shortage. | PARTIAL; exercise exact RC-13 saved settings (Technology + Economy, 4, Intermediate, 20 minutes), over-budget/difficulty-mismatch decisions and a denied fit candidate. | Acceptance-only controlled fixture through collector’s deterministic final selector. |
| PAT-RC-07 | Same mock-only discovery assertions as above. | NEW_RUN_REQUIRED; original observation is preference-only real online discovery. | Reuse PAT-V11-06 live collection. |
| PAT-RC-08 | `editorial.test.ts` duplicate copy exclusion and retained source. | SUFFICIENT. | None. |
| PAT-RC-09 | `editorial.test.ts` re-fetch test preserves original vs accessible attribution. | PARTIAL; does not simulate original inaccessible and a separately verified recovery version. | Acceptance-only source-recovery fixture with objective failure and correctly attributed accessible version. |
| PAT-RC-10 | Same re-fetch attribution test. | PARTIAL; no independent alternative-source article with its own attribution and original failure retained. | Reuse source-recovery fixture, with distinct alternative article. |
| PAT-RC-11 | `service.test.ts` all-source outage and semantic failure preserve old issue/progress; controlled retries. | SUFFICIENT. | None. |
| PAT-RC-12 | `editorial.test.ts` shortage returns PARTIAL and unmet count. | SUFFICIENT. | None. |
| PAT-RC-13 | `editorial.test.ts` COMPLETE evidence uses Finance, 2 articles, fixture-derived budget/difficulty. | PARTIAL; frozen RC-13 is Technology + Economy, 4 Intermediate, 14–20/20 minutes. | Reuse the exact-settings V11-10 controlled fixture. |
| PAT-RC-14 | Same selection/shortage assertions prove standards are not lowered. | PARTIAL; V11-10 controlled invalid combination is the missing direct exercise. | Reuse PAT-V11-10 fixture. |
| PAT-RC-15 | `editorial.test.ts` summary-only candidate is not FULL_TEXT and is excluded. | SUFFICIENT. | None. |
| PAT-RC-16 | `editorial.test.ts` 404/disappeared candidate and incomplete-body rejection. | SUFFICIENT. | None. |
| PAT-RC-18 | `service.test.ts` controlled clock merges manual PARTIAL into same Issue and completes without using retry budget; semantic-failure test checks delivered context shape. | PARTIAL; missing successful scheduled semantic completion that sees prior overlap and adds only a new eligible article. | Acceptance-only controlled-clock service fixture. |
| PAT-RC-26 | Same-event reporting and independent analysis survive dedupe in `editorial.test.ts`. | SUFFICIENT. | None. |
| PAT-RC-27 | `editorial.test.ts` covers identical copies and an independent pair below 0.85. | PARTIAL; no nonidentical body at or above 0.85 with the frozen rejection trace. | Acceptance-only near-copy variant through candidate dedup. |
| PAT-RC-28 | Same-event distinct content is retained; event identity itself is not the dedupe key. | SUFFICIENT. | None. |
| PAT-RH-09 | UI component tests use synthetic body only. | NEW_RUN_REQUIRED; open actual verified live full text in Reader and observe multiple readable paragraphs/continuous body. | Reuse browser flow from real collection. |
| PAT-RH-12 | UI tests cover contract shape; no actual external-only candidate flow. | NEW_RUN_REQUIRED; show real summary/unavailable candidate as external-only and excluded from actual count. | Reuse same browser flow if live collection retains such a candidate; otherwise one candidate-bound product trace. |
| PAT-RH-15 | `ReaderWorkspace.test.tsx` and `service.test.ts` controlled-clock Regenerate preserve old edition/article/progress. | SUFFICIENT direct behavior assertions. | None. |

Historical V1 case text remains unchanged. Planned shared live run covers only applicable product observations; acceptance-only fixtures are not production fallback evidence.
