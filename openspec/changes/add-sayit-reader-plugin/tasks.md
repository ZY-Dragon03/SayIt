# Tasks

## 1. Product Owner Review Gate

- [ ] 1.1 Review and decide each item in `design.md` under “Product Owner Decisions Before Freeze”; verify that the decisions are recorded and reconciled across `proposal.md`, the three delta specs, and `design.md` before any implementation begins.
- [ ] 1.2 Review and approve or revise the 36 Product Acceptance Cases in the delta specs; verify each names an observable user action and result, and mark the product contract frozen only after explicit Product Owner confirmation.

## 2. Service and Data Foundation (After Product Approval)

- [ ] 2.1 Select the scheduled collection runtime and discovery/full-text provider using the approved cost, attribution, content access, retry, and retention policies; verify startup catch-up, quota, secret handling, failure behavior, and deployment path are documented.
- [ ] 2.2 Define versioned Reader preference, run, article, and progress records without changing `sayit.history.v1` or `sayit.saved.v1`; verify persistence and upgrade behavior with focused storage tests.
- [ ] 2.3 Add an Editorial Agent collection interface and dynamic discovery adapter boundary; verify the Agent can discover from preferences without a complete preloaded URL list and provider credentials never enter the browser bundle.

## 3. Reader Mode and Collection Lifecycle

- [ ] 3.1 Add optional Reader mode and transition handling while retaining the SayIt primary workspace state; verify PAT-RM-01 through PAT-RM-06 with state-preservation tests.
- [ ] 3.2 Add preference editing and persistence for topics, count, difficulty, time budget, local collection time, and timezone; verify saved values survive an application restart.
- [ ] 3.3 Implement the approved scheduled occurrence lifecycle, service-start catch-up, bounded retry, and isolated Manual Run now behavior; verify schedule state, attempt history, Daily Issue outcome, and PAT-RC-02 through PAT-RC-06.

## 4. Discovery, Verification, and Curation

- [ ] 4.1 Have the Editorial Agent generate and execute live discovery queries from saved preferences; verify PAT-RC-07 with no complete preloaded candidate URL list and a reviewable discovery/decision trace.
- [ ] 4.2 Fetch and verify original and accessible article versions, reject summaries, recheck disappeared sources, deduplicate repeated stories, and retain attribution; verify PAT-RC-08 through PAT-RC-10 and PAT-RC-15 through PAT-RC-16.
- [ ] 4.3 Curate the exact approved article count, topics, difficulty, and total reading-time limit; verify PAT-RC-12 through PAT-RC-14 distinguish complete fulfillment from explicit partial supply without relaxing saved preferences.

## 5. Reading Workspace and SayIt Reuse

- [ ] 5.1 Build the daily list and immersive article view with Quiet Fluent Utility styling, readable in-app full text, and honest external-link-only status; verify PAT-RH-01, PAT-RH-09, and PAT-RH-12.
- [ ] 5.2 Route single-word selection to the existing local dictionary/IPA/Listen path and phrase/sentence selection to existing interpretation with necessary article context; verify PAT-RH-13 and PAT-RH-14 without replacing primary workspace state.
- [ ] 5.3 Reuse existing IPA, speech, Save, and Copy actions where supported by the returned result type; verify PAT-RH-04 and PAT-RH-10 restore the prior article and reading position.

## 6. Archive, Progress, and Product Acceptance

- [ ] 6.1 Persist daily article history, original/accessed source metadata, reading status, and position; cache only approved full text and verify PAT-RH-06 and PAT-RH-11 provide date-based offline continuity without misrepresenting external-only candidates.
- [ ] 6.2 Add approved retention and user data-clearing controls; verify clearing Reader data leaves SayIt interaction history and saved expressions unchanged.
- [ ] 6.3 Run Product Acceptance against all 36 approved PAT-RM, PAT-RC, and PAT-RH cases; verify the report identifies the tested application build and records pass/fail evidence for each case.
