# Tasks

## 1. Frozen Product Contract

- [x] 1.1 Reconcile product decisions A–D across proposal, design, and all delta specs; retain F1–F10 and preserve valid original PAT meanings.
- [x] 1.2 Verify the complete 49-case set: PAT-RM-01–06, PAT-RC-01–28, PAT-RH-01–15; every case has an observable action and result.
- [x] 1.3 Run strict OpenSpec validation, commit the reconciled contract, and create an annotated v1.0 freeze tag that records the contract commit SHA.

## 2. Implementation, Acceptance, and Feasibility Plans

- [x] 2.1 Record the local Windows target architecture, service lifecycle, storage/API boundaries, security constraints, dependency verdicts, and rollback path.
- [x] 2.2 Map all 49 PATs to candidate-bound engineering tests or manual product evidence; define clock-controlled schedule scenarios and real-network acceptance inputs.
- [x] 2.3 Validate at least one no-cost dynamic discovery path and readable-source path without committing to a new paid service; document limits and fallback behavior.

## 3. Local Collection Service and Persistence

- [ ] 3.1 Add versioned Reader preference, schedule occurrence, attempt, Daily Issue edition, candidate, and reading-progress records without changing SayIt history or Saved formats.
- [ ] 3.2 Add local Reader service APIs for preferences, issues/archive, run status, Regenerate, and article content with safe local-only binding, validation, timeouts, and error states.
- [ ] 3.3 Implement one occurrence per local date, plan-time waiting, current-day-only startup catch-up, historical MISSED recording, bounded retry, DST behavior, and service/UI independence.
- [ ] 3.4 Verify Manual, scheduled, and catch-up attempts merge into one dated Issue; complete Issues suppress scheduled discovery; partial Issues can be completed; Regenerate preserves prior editions and progress.

## 4. Editorial Agent Discovery and Curation

- [ ] 4.1 Generate dynamic online queries from saved preferences and record query/candidate/decision traces; no complete preloaded article URL list may be supplied to the Agent.
- [ ] 4.2 Fetch public accessible originals safely; extract and verify readable English body text; distinguish original publication from accessible version; reject summaries, login/paywall responses, disappeared pages, and unverified copies.
- [ ] 4.3 Deduplicate identical, syndicated, mirrored, and near-duplicate text without rejecting independent reporting or distinct analysis about the same event.
- [ ] 4.4 Compute the visible 200-words-per-minute reading estimate and Flesch–Kincaid difficulty score; curate exact count, topics, difficulty, and 70%–100% time target, otherwise return explicit PARTIAL/NOT_DELIVERED.
- [ ] 4.5 Run and preserve evidence from a real network-based Editorial Agent collection using preferences only as discovery input.

## 5. Reader Workspace and SayIt Reuse

- [x] 5.1 Add default-off Reader activation and deactivation while preserving the mounted SayIt workspace and its input, result, context, saved data, and history.
- [ ] 5.2 Add persistent preference editing and quiet daily-issue/archive views with complete/partial/failure states and source attribution.
- [ ] 5.3 Deliver readable article bodies in-app; display external-only candidates honestly; implement word lookup through the local dictionary/IPA/Listen path and phrase/sentence interpretation with necessary article context.
- [ ] 5.4 Persist article selection, reading position, progress, issue editions, and only explicitly cache-permitted full text; restore after Reader restart and support offline access to eligible cached content.
- [x] 5.5 Confirm Reader SayIt actions preserve the primary SayIt workspace and successful interpretation is recorded in existing SayIt interaction history.

## 6. Integration and Engineering Verification

- [ ] 6.1 Integrate service and Reader UI into one candidate without changing frozen acceptance meanings.
- [ ] 6.2 Run focused storage, scheduler/clock, discovery, extraction, curation, API, and UI tests plus the full project test and build commands.
- [ ] 6.3 Exercise restart, offline, failure recovery, source attribution, duplicate/viewpoint, data isolation, and Regenerate flows on the integrated candidate.

## 7. Product Acceptance

- [ ] 7.1 Run all 49 frozen PAT-RM, PAT-RC, and PAT-RH cases against one identified integrated candidate; record PASS/FAIL/NOT-RUN and evidence for each case.
- [ ] 7.2 Run a real dynamic network collection and a real article-selection → existing SayIt interpretation flow on that candidate; mocked tests alone do not satisfy these cases.
- [ ] 7.3 Obtain Acceptance Engineer disposition without asking that role to repair code; remediate failures through implementers, then rerun only invalidated acceptance evidence and issue the final candidate-bound report.
