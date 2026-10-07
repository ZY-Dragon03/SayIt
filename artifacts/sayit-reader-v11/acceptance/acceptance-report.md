# PIW V1.1 Acceptance Adjudication

## Candidate and claim ceiling

- Candidate: `a33e7ff1a881551ade59b37e38da24fca05a7dc4`
- Tree: `bb9175405b17741114f2a1e86e393891487f46b1`
- Parent: `628aa110e59b5f77bcb5bcd4782acf0b1f959970`
- Main base: `d80e13c327ac2a8672e0eee95584cb4333dd422b`
- Frozen product contract: `sayit-reader-v1.1-product-contract-r1`; SHA256 `5d58710e6fd10df211f69db4cbcd91f035a0a71a874d918aa013861f2769692d`
- Source delta from the previously failed candidate: `server/reader/semantic.ts` and `server/reader/semantic.test.ts` only. Candidate guard and acceptance scripts bind the commit and tree; product-source paths were clean at final readback.
- Claim ceiling: AE adjudication only. PM alone declares PRODUCT_ACCEPTED.

## Adjudication totals

| Group | PASS | FAIL | NOT-RUN |
|---|---:|---:|---:|
| New PAT-V11-01–10 | 8 | 0 | 2 |
| Affected V1 observations | 14 | 0 | 3 |
| Total | 22 | 0 | 5 |

The two live collection flows did not produce a positive unknown-publisher full-text/semantic observation. No reproducible product defect was established from the single bounded source diagnosis. PAT-V11-01 and PAT-V11-06 remain NOT-RUN for their required positive observation. PAT-RC-07 did not deliver a dynamically discovered full-text article. The requested browser observations remain NOT-RUN because CUA could not open or connect to a browser tab (`nodeRepl.fetch request failed`); no browser assertion is claimed.

## New PAT matrix

| Case | Result | Evidence and adjudication |
|---|---|---|
| PAT-V11-01 | NOT-RUN | No real unlisted-publisher article passed source/body verification and selection eligibility. Infostream is synthetic. The live MIT Technology Review candidate failed the recorded standalone/title predicate; see `pat-v11-06-single-page-diagnosis-technologyreview-a33e7ff1.json`. No positive is inferred. |
| PAT-V11-02 | PASS | `candidate-observations.acceptance.ts` exact unknown publisher vs `og:site_name` conflict: `Publisher identity metadata conflicts.`, `EXTERNAL_ONLY`, count 0, no semantic call. A separately rejected real MIT Technology Review candidate is another traced example; its validity is inconclusive from retained evidence. |
| PAT-V11-03 | PASS — semantic selection only | Real configured DeepSeek/deepseek-flash receipt proves three verified input IDs, one request, repetitive keyword-heavy item rejected, explanation and independent perspective selected with content-grounded rationales. The collection is `PARTIAL` at 2.345/5 minutes, below the 70% floor; this receipt does not prove COMPLETE fulfillment. |
| PAT-V11-04 | PASS | Candidate `editorial.test.ts` same-event flow keeps independent reporting/analysis while a copied article does not occupy another slot; see direct assertions at lines 556–580. |
| PAT-V11-05 | PASS | Candidate semantic tests reject invalid versions, missing/duplicate/foreign IDs, illegal judgments, unconfigured topics, contradictory approvals, and source-authority fields; shared trace schema rejects source/completion authority. |
| PAT-V11-06 | NOT-RUN | Two real saved-preference collections ran without a preloaded article URL list. They included absent-from-map sources and objective rejection traces, but neither produced a successful FULL_TEXT verification or semantic decision for an unlisted publisher. No third broad run was made. |
| PAT-V11-07 | PASS | Candidate safe-fetch assertions cover private/local IPv4/IPv6, mixed DNS answers, redirect re-resolution, vetted IP/NO_PROXY, and unsupported proxy fail-closed behavior; semantic response authority fields are rejected. |
| PAT-V11-08 | PASS | Candidate semantic tests prove missing config, provider error, invalid response, and one bounded repair fail closed. Candidate service tests preserve issue/progress on outages and bound scheduled attempts to three. |
| PAT-V11-09 | PASS | `pat-v11-09-18.acceptance.ts` replays only the saved PAT03 decisions/trace through isolated candidate ReaderService/ReaderStore storage; a new service instance retrieved both rationales, contract version, contribution types, provenance, and semantic trace. Removing optional fields still loaded both historical full-text records without invented rationale. |
| PAT-V11-10 | PASS | Exact Technology + Economy, four Intermediate articles, 20-minute target selected four at 19.8 minutes. Over-budget, wrong-difficulty, and semantically denied cases were not selected; result was COMPLETE. |

## Affected V1 matrix

| Case | Result | Evidence and adjudication |
|---|---|---|
| PAT-RC-07 | NOT-RUN | The real saved-preference runs did not deliver any dynamically discovered full-text article. Receipts explicitly show no URL list input, four queries, and 0 full-text selections. |
| PAT-RC-08 | PASS | Candidate `editorial.test.ts:556–580` rejects duplicate body content and retains the source article. |
| PAT-RC-09 | PASS | `pat-rc-09-10.acceptance.ts` proves an original HTTP 403 remains EXTERNAL_ONLY and contributes 0 full-text count; the separate redirect re-fetch assertion at `editorial.test.ts:582–609` keeps Original and Accessible attribution distinct. PAT-V11-02 separately proves conflicting metadata is not collapsed. |
| PAT-RC-10 | PASS | Same source-recovery control retains the original 403 reason and selects a different verified article under its own URL and page publisher metadata. The product's original host display label is host-derived; the accessible publisher and provenance reflect page metadata. |
| PAT-RC-11 | PASS | Candidate `service.test.ts:197–386` preserves the old issue/progress for source and semantic failures and records failure/retry state. |
| PAT-RC-12 | PASS | Candidate `editorial.test.ts:624–642` keeps PARTIAL and unmet count when sources disappear rather than weakening preferences. |
| PAT-RC-13 | PASS | Same exact-settings V11-10 receipt: 4 Technology/Economy Intermediate articles, 19.8/20 minutes, COMPLETE. |
| PAT-RC-14 | PASS | Same V11-10 receipt rejects over-budget, measured Advanced, and semantic-denial fixtures while retaining saved constraints. |
| PAT-RC-15 | PASS | Candidate `editorial.test.ts:378–392` keeps summary-only content out of FULL_TEXT and the count. |
| PAT-RC-16 | PASS | Candidate `editorial.test.ts:502–554` records HTTP 403/404 and summary-only failures while selecting only verified full-text results; source-recovery receipt adds the external-only 403 count assertion. |
| PAT-RC-18 | PASS | Controlled-clock candidate flow created PARTIAL manually, passed the prior issue article in the scheduled semantic input, rejected an overlapping verified candidate, and reached COMPLETE in the same issue with only the new article added. Receipt `pat-rc-18-a33e7ff1-bb917540-2026-10-07T04-39-12-201Z.json`. |
| PAT-RC-26 | PASS | Candidate `editorial.test.ts:556–580` retains independent same-event reporting and analysis. |
| PAT-RC-27 | PASS | `candidate-observations.acceptance.ts` nonidentical near-copy has shingle Jaccard ≥0.850 and receives the frozen near-duplicate trace reason; it does not receive another slot. |
| PAT-RC-28 | PASS | Candidate `editorial.test.ts:556–580` proves shared event identity does not deduplicate independent content. |
| PAT-RH-09 | NOT-RUN | No actual readable full-text article was available to open in the browser; CUA browser setup failed with `nodeRepl.fetch request failed`. Synthetic component tests are not substituted for the frozen browser observation. |
| PAT-RH-12 | NOT-RUN | No browser observation of the actual external-only state; the same CUA bridge failure prevented product UI inspection. API/collector status assertions do not substitute for the frozen browser observation. |
| PAT-RH-15 | PASS | Candidate `service.test.ts:479–523` and `ReaderWorkspace.test.tsx:434–595` preserve the prior edition/article and carry reading progress through confirmed Regenerate. |

## Live evidence and blockers

- **Real provider:** `pat-v11-03-a33e7ff1-bb917540-2026-10-06T15-44-50-606Z.json`, SHA256 `5D5EE240BC4B8CB1520CC714BCF25975C7014F40A5EE7CE28B769DE8686A1653`. One bounded configured DeepSeek request; real model selected grid explanation plus rural perspective and rejected repetitive commodity coverage. Issue fulfillment was PARTIAL due the 70% time floor.
- **Real broad discovery:** startup catch-up had 4 queries, 36 unique URLs, 40 trace rows; the saved-preference manual run had 4 queries, 28 unique URLs, 38 rows, no supplied article URL list, and 0 FULL_TEXT/semantic decisions. Receipts and hashes are in `evidence-index.json`. These runs establish real discovery activity and negative outcomes, not the required unknown-publisher positive.
- **Real unknown rejected example:** MIT Technology Review article URL `https://www.technologyreview.com/2026/09/28/1145197/whos-liable-when-ai-agents-go-rogue` was fetched at HTTP 200 and traced as `REJECTED` with exact reason `Standalone article structure and title metadata do not agree.` The safe refetch had matching Readability/structured/og titles, English language, `og:type=article`, 39 Readability paragraphs and 1,941 words. It showed zero `<article>` roots, but the saved `h1Values` only counts headings inside article roots; it does not prove the page lacks a page-level H1. The canonical only differed by a trailing slash, which candidate URL normalization removes. No citation/article-publisher signal or structured article-body boundary was retained, and the original search-result title was not saved. Thus the trace shows the exact rejection predicate, but retained data does not prove that the page satisfied every frozen completeness/provenance predicate or establish a reproducible false rejection.
- **Unknown invalid controlled example:** the V11-02 fixture uses `Riverland Technology Journal` versus `North Coast Market News`; it deterministically returns `Publisher identity metadata conflicts.`, EXTERNAL_ONLY, count 0, and never calls semantic review.
- **Real unknown accepted example:** none observed. No fabricated or synthetic example is presented as real.
- **Browser blocker:** CUA was used for browser setup; Edge/IAB tab creation and `getState()` failed with `nodeRepl.fetch request failed`. No browser UI observation is claimed. The acceptance Vite server was stopped after the live collection runs.
- **Historical failure lineage:** the immutable 628aa110 PAT03 failed receipt remains preserved as `pat-v11-03-628aa110-tree-146b7a9f-instrumented-failure.json`; it is not used as evidence for this candidate. The successful a33e7ff1 receipt above is separate.

See [evidence-index.json](evidence-index.json) for full candidate-bound receipt paths, hashes, commands and direct assertion references.
