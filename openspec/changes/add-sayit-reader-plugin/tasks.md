# Tasks

## 1. Product Owner Review Gate

- [ ] 1.1 Review and decide each item in `design.md` under “Product Owner Decisions Before Freeze”; verify that the decisions are recorded and reconciled across `proposal.md`, the three delta specs, and `design.md` before any implementation begins.
- [ ] 1.2 Approve or revise the Product Acceptance Cases in the delta specs; verify each approved case names an observable user action and result, and mark the product contract frozen only after explicit Product Owner confirmation.

## 2. Service and Data Foundation (After Product Approval)

- [ ] 2.1 Select the discovery/full-text provider and production service boundary using the approved cost, attribution, content access, and retention policies; verify the selected provider, quota, secret handling, failure behavior, and deployment path are documented.
- [ ] 2.2 Define versioned Reader preference, run, article, and progress records without changing `sayit.history.v1` or `sayit.saved.v1`; verify persistence and upgrade behavior with focused storage tests.
- [ ] 2.3 Add a Reader collection service interface and provider adapter boundary; verify candidate search can be supplied dynamically and provider credentials never enter the browser bundle.

## 3. Reader Mode and Collection Lifecycle

- [ ] 3.1 Add optional Reader mode and transition handling while retaining the SayIt primary workspace state; verify PAT-RM-01 through PAT-RM-06 with state-preservation tests.
- [ ] 3.2 Add preference editing and persistence for topics, count, difficulty, time budget, local collection time, and timezone; verify saved values survive an application restart.
- [ ] 3.3 Implement the approved open-only daily run and Manual Run now policy, including timezone boundaries, run locking, foreground recovery, visible statuses, and retry behavior; verify the approved PAT-RC scheduling and failure cases.

## 4. Discovery, Verification, and Curation

- [ ] 4.1 Discover candidates dynamically from the approved service based on saved topics; verify new eligible candidates can arrive without editing a hardcoded source list.
- [ ] 4.2 Fetch and extract original pages, validate language and readable article content, deduplicate candidates, and retain source attribution; verify inaccessible, partial, duplicate, and valid full-text examples against PAT-RC-07 through PAT-RC-10.
- [ ] 4.3 Curate the approved count, difficulty, and reading-time target, and report shortfalls without treating unverified candidates as delivered articles; verify partial completion is visible and accurate.

## 5. Reading Workspace and SayIt Reuse

- [ ] 5.1 Build the daily list and immersive article view with Quiet Fluent Utility styling and visible actual-source attribution; verify PAT-RH-01 using representative article content.
- [ ] 5.2 Add contextual word, phrase, and sentence selection that routes to the existing SayIt retrieval/interpretation path without replacing primary workspace state; verify empty selections do not send requests and the original session remains intact.
- [ ] 5.3 Reuse existing IPA, speech, Save, and Copy actions where supported by the returned result type; verify article scroll position is restored after opening and closing the contextual result.

## 6. Archive, Progress, and Product Acceptance

- [ ] 6.1 Persist daily article history, source metadata, reading status, and position in the approved local archive; verify earlier articles remain readable offline if full-text retention is approved, and verify history can be browsed by date.
- [ ] 6.2 Add approved retention and user data-clearing controls; verify clearing Reader data leaves SayIt interaction history and saved expressions unchanged.
- [ ] 6.3 Run Product Acceptance against every approved PAT-RM, PAT-RC, and PAT-RH case; verify the acceptance report identifies the tested application build and records pass/fail evidence for each case.
