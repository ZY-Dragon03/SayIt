# SayIt Reader v1.1 Agentic Editorial Implementation Handoff

Date: 2026-10-06
Worktree: `F:\AI_PROJECTS\SayIt\.worktrees\sayit-reader-v11-agentic-editorial`
Branch: `feature/sayit-reader-v11-agentic-editorial`
HEAD at verification: `08a9e62f79ae832d917545cb5d7e29e8d45819e8`
Product contract: `sayit-reader-v1.1-product-contract-r1`
Claim ceiling: **IMPLEMENTED / ENGINEERING VERIFIED**. No live acceptance, PAT PASS, or product acceptance claim.

## Implementation summary

- Reused `DeepSeekProvider`'s existing JSON completion transport through `JsonCompletionClient` and `createDeepSeekJsonCompletionClient`. SayIt `retrieve` still uses its existing API, prompt, context handling, 12-second timeout, and 700-token default. Vite passes the existing DeepSeek configuration to Reader in development without printing configuration values.
- Removed publisher-root FULL_TEXT authority. Publisher-name normalization remains display-only. FULL_TEXT now requires attributable publisher metadata, a canonical URL matching the discovered or accessible URL, a standalone article root with agreeing title metadata, a verified body boundary, and the existing HTTP/access, English, listing, minimum-body, paragraph-completeness, and structured-body coverage checks. Known and unknown publishers use the same checks.
- Switched discovery to broad preference-generated queries and kept keyword matches as evidence. Deduplication remains based on normalized URLs, body hashes, and text shingles. Semantic decisions run only after objective source validation and content dedupe; only validated approved candidate IDs enter deterministic count, measured difficulty, 200-words-per-minute, and 70–100% time selection.
- Added the versioned `reader-editorial-curation.v1` semantic adapter. Inputs and outputs are strict and bounded; candidate IDs must be unique and returned exactly once. The model receives no URL, fetch capability, access/full-text authority, or metric/completion authority. Missing configuration, provider failures, and invalid structures fail closed with persisted status/reason and existing bounded retry behavior. There is no production heuristic fallback.
- Added optional article provenance/editorial decision fields and semantic trace/attempt status fields. Rationale, contribution, contract version, and provenance persist in the existing store and article API. Historical V1 records without the optional fields still parse.
- Same-issue completion passes at most 12 previously delivered full-text summaries to semantic review. The summaries contain title, publisher, topics, measured difficulty/time/count, and prior contribution type; no full article body is added to the context.

## Actual engineering bounds

- At most 12 new candidate IDs are sent to semantic review per collection. Additional verified candidates are explicitly traced as outside the semantic request capacity.
- Article evidence is sampled from the beginning, middle, and end and sent at no more than 2,400 characters per candidate. The adapter accepts at most 12,000 raw evidence characters before clipping.
- At most 12 existing article summaries are included. Optional context evidence is limited to 240 characters; the service currently sends metadata only.
- Combined system and user prompt size is at most 40,000 characters, leaving at least 256 characters for the one permitted repair instruction.
- A semantic request is limited to 30 seconds and 4,096 output tokens. There can be one structure repair, for at most two semantic provider requests per collection.
- Readability reconstruction is allowed only when the source paragraph set has explicit article-body evidence or a verified standalone article boundary (excluding publisher-specific body-only roots), Readability's returned paragraphs are all contained in that source set, and at most 10% of source paragraphs were omitted. Larger omissions and publisher-body-only omissions fail closed. This is stricter than unrestricted reconstruction and preserves exact paragraph coverage after any permitted reconstruction.
- Discovery uses at most 12 broad query variants, at most 12 results per query, and at most 36 URL candidates by default. No source allowlist expansion was made.

## Verification log

Commands ran in this worktree against the unchanged lockfile. No live provider or search acceptance was run.

```text
npm.cmd ci
  PASS: 148 packages added; 149 audited; repository package manifests and lockfile unchanged.
  Environment reported 4 audit findings (1 moderate, 1 high, 2 critical) and one deprecated-package warning; no audit fix was run.

npm.cmd run typecheck
  PASS: tsc --noEmit; no diagnostics.

npx.cmd vitest run server/provider.test.ts server/reader/semantic.test.ts server/reader/editorial.test.ts server/reader/service.test.ts server/reader/store.test.ts server/reader/api.test.ts server/reader/safe-fetch.test.ts src/reader/api.test.ts src/shared/reader-contract.test.ts
  PASS: 9 test files, 92 tests.

npm.cmd test
  PASS: 22 test files, 150 tests.

npm.cmd run build
  PASS: tsc -b and Vite production build.
  Existing dependency warnings: Rollup removed two Zod comment annotations; Vite reported the phonemizer chunk exceeds 500 kB.

git diff --check
  PASS: no whitespace errors.

git diff --quiet -- package.json package-lock.json server/reader/safe-fetch.ts src/reader
  PASS: no changes in the checked forbidden implementation/package/UI paths.
```

The focused suite includes semantic structure/authority and request bounds, provenance failures for both a known and unknown publisher, existing safe-fetch regressions, service semantic failure status/reason preservation with unchanged issue/progress, store restart and historical-record compatibility, and article API retrieval of rationale/provenance after loading a fresh store.

## Product/test source manifest

`git hash-object` values after final source/test edits; these paths were not staged or committed.

```text
server/provider.ts d28a5a26f990d7b61e141d3669f0c4e85b8eeff5
server/provider.test.ts 845614445e841f5ba70b04a5ef1741979d1d4d16
server/reader/semantic.ts 9a06aa57e382b35c1e2ea8591ac243d0967bc767
server/reader/semantic.test.ts ebf6eceea94e42e650ceb75c96e2823d26de3fc4
server/reader/editorial.ts 7760b65113511caf5491e2f2886f508aa807fb4b
server/reader/editorial.test.ts 85d8cecf5e74b41453794157cc1b5198bfab41e1
server/reader/service.ts 787bd8f03251cce10fe1ddda45ea21270d19d2a2
server/reader/service.test.ts 6d139931af7dbec3576b711c640c01319886027d
server/reader/store.ts 77863eb1c5dad6d11ffb90595fb2f2ab2b8c6c77
server/reader/store.test.ts fdd6ca7d2ba7d9585bf8edb1440ee4ab45c06028
server/reader/api.test.ts b2b27b245bc6b141d4b91925bf63162ff18fcf4b
src/shared/reader-contract.ts 1cf329b169047901f6469a8024924f6547423637
src/shared/reader-contract.test.ts 49fb031eeb0f3baafe986b9b4c27077944ab5cf4
vite.config.ts 72dc9ea07585c87891d960f288cc738a70ebe417
```

## Ownership and status notes

- No frozen contract or V1 historical specification/acceptance evidence was modified. Existing provider/Reader product source was intentionally changed within the assigned ownership. `server/reader/safe-fetch.ts`, normal Reader UI/engine, package manifests/lockfile, local ignored environment files, and user keys were not changed.
- PM-owned `openspec/changes/agentic-editorial-curation-dynamic-source-trust/execution.md` was concurrently modified in the shared worktree and was not edited by this implementer.
- No product source was staged or committed. Independent Agentic Editorial acceptance remains outstanding.
