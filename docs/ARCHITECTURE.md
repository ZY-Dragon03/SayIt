# Architecture and behavior contracts

This document holds the engineering notes behind SayIt's behavior. It is written for
people changing the code; the [README](README.md) is written for people using it.

The sections below are behavior contracts, not implementation trivia. If you change
one of them, change this document in the same commit.

## Modes and shell

`App.tsx` owns one shell with two workspaces. `ReaderWorkspace` stays mounted and is
hidden with `hidden={!active}`, so switching modes never destroys in-memory reading
state. A workspace switch keeps the current view: an article left at paragraph 20
comes back at paragraph 20, and the issue list stays the issue list.

## SayIt result cache

Repeated successful SayIt queries are served from one shared local cache instead of
spending another model call. It is used by both modes, and it is not History: History
records what you asked and used, while the cache answers "do we already have a valid
model answer for this request?".

- A normalized single lexical word (`Psychologically`, ` psychologically `,
  `PSYCHOLOGICALLY`) is one context-free entry shared by both surfaces.
- A Reader phrase or sentence keys on **both** its normalized selection and its
  normalized article sentence, so two different selections of the same length inside
  one sentence never share an entry, and a context-specific interpretation is never
  reused in an unrelated context.
- Only validated successful `SayItResult` objects are stored. Clarification and
  no-match answers are always re-asked.
- Reader reads the cache when a selection is finalized, so a word or phrase it
  already knows opens directly into the detailed SayIt result with no extra SayIt
  press and no `/api/retrieve` call. A selection it does not know keeps the
  lightweight local state (IPA, local dictionary, Listen, Copy, SayIt icon).
- That passive cache read is not a SayIt interaction: it never writes History by
  itself. An explicit SayIt action that hits the cache still behaves like a SayIt
  interaction and follows the normal History dedupe policy. A local
  dictionary-only selection never writes History or the cache.

The cache lives under the browser-local key `sayit.result-cache.v2`. Changing the
retrieval prompt, model, result shape, or cache identity policy **must** bump
`SAYIT_CACHE_SCHEMA_VERSION` in `src/lib/sayit-cache.ts` and the storage key with it,
so stale answers cannot be reused. A superseded `sayit.result-cache.v1` store is
deleted on first use because its Reader phrase entries keyed on word count and are
unsafe.

## Local IPA

`src/lib/ipa.ts` is the only module that knows about a pronunciation engine. The
renderer and the cache never import one directly, so the engine can be replaced
without touching the UI.

- The engine is **`phonemize`** (MIT). `us` maps to `en-US` and `uk` to `en-GB`.
- SayIt bundles no GPL-derived engine. See
  [`THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md) and
  `openspec/changes/replace-llm-ipa-with-local-lookup/design.md`.
- The engine is loaded lazily, only when an IPA is actually needed, and a failure,
  an empty result, or clearly non-language/code-like input returns `null` and hides
  the IPA line rather than blocking the result.
- Successful values are cached by `${accent}:${normalizedText}` under
  `sayit.ipa.v2`, and concurrent lookups for one key share a single promise.
- **Any change to the engine or the pronunciation behavior must bump this cache
  key** (for example to `sayit.ipa.v3`) so stale IPA from the previous engine is
  never reused. It was bumped from `sayit.ipa.v1` when eSpeak NG was replaced.

## Speech playback

Playback uses the browser's Web Speech API only; no audio is generated, stored, or
uploaded. The voice list is warmed at startup and the selected US/UK voice is reused,
so pressing Listen does not pay a multi-second voice-discovery cost. The service
cancels the engine only when playback is actually pending or speaking.

## Reader state integrity

Reader state lives in one SQLite database, `reader-state.db` in the Reader directory
(`%LOCALAPPDATA%\SayIt\Reader\`), in WAL mode with `synchronous=NORMAL`.

- Every mutation runs inside `BEGIN IMMEDIATE`, which takes the write lock **before**
  the state is read, so the development server and the scheduled task cannot both
  read one version, compute independent mutations, and overwrite each other.
- A failed read always raises an error. It never falls back to a process's in-memory
  copy, because that copy is exactly what would silently resurrect lost data.
- Reads on the request path adopt the newest committed state first, so the UI never
  serves the snapshot a long-lived process happened to load at startup.
- A mutation writes only the tables whose data actually changed.
- An existing `reader-state.json` is imported exactly once on first start and kept as
  the operator's record; a later edit to it is not adopted.
- Permitted article bodies live in the same database, so a body and its metadata
  commit or roll back together, and nothing outside a permitted record is persisted.
- `ReaderStore.close()` releases the file; the one-shot scheduled task does this at
  exit.

## Reader run ownership

A collection attempt is owned by the process running it, through a claim recorded
with the attempt **in the same transaction** and refreshed by a heartbeat; the lease
window is 120 seconds and the heartbeat runs at a third of it.

- Only one process can hold a claim, so two simultaneous "Collect now" presses, or a
  scheduled run racing a manual one, resolve to a single collection.
- A process that starts while another process's run is live leaves that run alone: it
  is not failed, not recovered, and not duplicated.
- An attempt whose owner stopped heartbeating is treated as an orphan only after the
  claim window lapses, and only then is it recovered and its occurrence made
  schedulable again — so a crash is repaired without a live peer ever being
  interrupted.

## Reader collection recovery

Collection work lives in memory, so after an unexpected service restart any attempt
still stored as `RUNNING` is orphaned: nothing will ever finish it, while the
scheduler and manual runs both refuse to start while one exists. On startup the
service marks those attempts failed (retryable) and returns their occurrence to a
schedulable state exactly once. This is idempotent and leaves issues, editions,
delivered articles, and reading progress untouched. Reconciliation never leaves an
occurrence `RUNNING` without a live attempt.

- Recovery never collects early. When the configured collection time is still ahead,
  an interrupted run leaves the schedule exactly as it was and the day is collected
  at its own time; catch-up happens immediately only once that time has passed.
- An occurrence is only `COMPLETED` when its Daily Issue actually reached `COMPLETE`.
  A run that finishes without fulfilling the issue stays inside the bounded retry
  budget (5 then 15 minutes, at most three scheduled attempts) and is only
  `EXHAUSTED` when that budget is spent, so a finished attempt is never confused with
  a successful delivery.

## Daily scheduling

Exactly one owner exists: the Windows scheduled task `SayIt Reader Collection`, which
runs `server/reader/scheduler-main.ts` every ten minutes through the bundled
`vite-node`. Each invocation is one bounded decision against the existing occurrence
and attempt records, so extra invocations are no-ops. It only reads today's issue and
never triggers a model call unless a collection is genuinely due.

The development server sets `scheduleRuns: false`: it still recovers interrupted
runs, still catches up an already-overdue date when it starts, and still serves
manual runs, but it never arms a competing timer. The task is registered by
`scripts/register-reader-task.ps1`.

A dated recovery only accepts articles the publisher states were published on or
before the named date, and refuses an article whose publication date its page does
not state. Discovery always runs at the present moment, so without that bound a newly
published article could be presented as an older day's reading.

## Article supply and difficulty

- Discovery merges official publisher RSS feeds with a search fallback into one
  deduplicated candidate set, then evaluates candidates semantically.
- FKGL is an approximate reading-difficulty estimator, not proof that a text is
  unsuitable, so it guides selection instead of gating it.
- An article within **one** difficulty tier of the saved preference is eligible, and
  the article nearest the saved difficulty is chosen first, so the tolerance never
  displaces a better match within the daily reading budget. An article two tiers away
  is still refused, the measured difficulty is reported as measured, and Reader
  reports the shortage rather than padding the issue.
- One rule (`measuredDifficulty` / `difficultyTierDistance` /
  `isDeliverableDifficulty` in `server/reader/editorial.ts`) serves both candidate
  selection and final issue fulfilment, so the two can never disagree.

## Reader navigation

Reader has three explicit states: `LATEST_ISSUE_LIST`, `READING_ARTICLE`, and
`VIEWING_HISTORICAL_ISSUE`. It opens on the latest scheduled issue, which is the most
recent date whose configured collection time has already passed, so before today's
collection time that is yesterday. When that issue delivered nothing, Reader says so
plainly and offers the most recent delivered issue underneath, dated as itself. Only
the actual current calendar date is ever labelled Today.

`sayit.reader.last-opened.v1` is a bookmark, not an instruction: an explicitly closed
article is never reopened because an old pointer exists. Article bodies already
loaded in a session are reused, so reopening the same article in the same session
makes no further request, and no restricted content is persisted for speed.

Reader also dismisses its selection popover when it is deactivated, and invalidates
pending selection work, so a popover can never float over SayIt and a late response
cannot recreate one while SayIt is on screen.

## History navigation

The top-right History icon opens one shared drawer in both workspaces, with two
sections and a stable position:

- **Reading** — Daily Issues, their delivered articles, and reading progress;
- **Expressions** — the SayIt query and interpretation history recorded by either
  workspace.

The drawer defaults to the section belonging to the active mode and can switch
sections without switching workspaces. The Reading section has one global `Latest` /
`Back to latest` action instead of a Today button on every row.

Opening History never changes the mode or the reading position. Opening an expression
while reading shows a preview panel and leaves the main SayIt input, result, and
session untouched (the drawer offers "Open in SayIt" for that). Opening a reading
article from SayIt deliberately switches to Reader, closes the drawer, and preserves
the SayIt state. Closing History dismisses its preview and restores the exact previous
workspace and position. The two storage models stay separate.

## Security boundary

- All API endpoints bind loopback and reject non-local callers; there is no remote
  listener, no CORS, and no user accounts.
- The DeepSeek key is server-side only. The browser never receives it, and `.env.local`
  is git-ignored and never read, copied, or logged by any endpoint.
- Article fetching is fail-closed: loopback, private, link-local, and reserved
  addresses, URL credentials, private DNS answers, and redirects that leave the
  verified public destination are all rejected.
- Reader cache permissions are respected per source; a non-permitted body is never
  stored.
