# SayIt

SayIt turns messy English thoughts into natural words, phrases, chunks, and sentences, and explains known expressions in context.

## Dogfood MVP

The current implementation is a small React + TypeScript + Vite app. The Vite development server owns the same-origin `/api/retrieve` proxy, so the DeepSeek key stays server-side.

### Run locally

```powershell
npm install
Copy-Item .env.example .env.local
```

Add your DeepSeek key to `.env.local`:

```text
DEEPSEEK_API_KEY=your-key
DEEPSEEK_MODEL=deepseek-flash
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Then start SayIt:

```powershell
npm run dev
```

Open the local URL printed by Vite. Type a rough English thought and press Enter. Use Shift+Enter for a new line.

## Daily use on Windows

Double-click the root-level **`Start SayIt.vbs`** file.

On the first run, open the generated `.env.local` file in Notepad, replace `your-key` with your DeepSeek key, save it, and double-click **`Start SayIt.vbs`** again.

It will:

- create `.env.local` from `.env.example` on the first run and tell you when to add `DEEPSEEK_API_KEY`;
- install dependencies automatically if `node_modules` is missing;
- start the existing Vite/SayIt server in a hidden window;
- wait for `http://127.0.0.1:5173/` to respond;
- open SayIt in the default browser;
- reuse an already-running SayIt server instead of starting a duplicate.

Node.js must be installed on Windows. The launcher uses Windows Script Host and does not require PowerShell execution-policy changes. Startup logs are written to `%TEMP%\SayIt\server.log`.

### Pronunciation playback

Useful English expressions can be played with the small speaker button beside the result. Playback uses the browser's built-in Web Speech API only; no audio is sent to SayIt or DeepSeek. Choose US/UK accent and Normal/Slow speed from the top bar. These preferences are saved in this browser. Voice quality and availability depend on the installed browser/system voices.

When available, the primary expression also shows a compact IPA transcription generated locally by the phonemizer engine. Switching US/UK changes both the displayed IPA and the spoken voice. If local generation returns no usable IPA, it is omitted instead of blocking the result.

IPA results use the browser-local cache key `sayit.ipa.v1`. Any change to the IPA engine or pronunciation behavior MUST bump this cache version/key (for example, to `sayit.ipa.v2`) so stale IPA is not reused.

The local IPA engine is approved for private/local Dogfood use only. Public distribution remains blocked pending a license/distribution review of bundled eSpeak NG code or replacement with a permissively licensed engine.

### SayIt result cache

Repeated successful SayIt queries are served from one shared local cache instead of spending another LLM call. It is used by both normal SayIt and Reader, and it is not History: History records what you asked and used, while the cache answers "do we already have a valid model answer for this request?".

- a normalized single lexical word (`Psychologically`, ` psychologically `, `PSYCHOLOGICALLY`) is one context-free entry shared by both surfaces;
- a Reader phrase or sentence keys on BOTH its normalized selection and its normalized article sentence, so two different selections of the same length inside one sentence never share an entry, and a context-specific interpretation is never reused in an unrelated context;
- only validated successful `SayItResult` objects are stored — clarification and no-match answers are always re-asked;
- Reader reads the cache when a selection is finalized, so a word or phrase it already knows opens directly into the detailed SayIt result with no extra SayIt press and no `/api/retrieve` call; a selection it does not know keeps the lightweight local state (IPA, local dictionary, Listen, Copy, SayIt icon) until you press SayIt;
- that passive cache read is not a SayIt interaction: it never writes History by itself;
- an explicit SayIt action that hits the cache still behaves like a SayIt interaction and follows the normal History dedupe policy;
- a local dictionary-only selection (no SayIt action) never writes History or the cache.

The cache lives under the browser-local key `sayit.result-cache.v2`. Changing the retrieval prompt, model, result shape, or cache identity policy MUST bump `SAYIT_CACHE_SCHEMA_VERSION` in `src/lib/sayit-cache.ts` and the storage key with it, so stale answers cannot be reused; a superseded `sayit.result-cache.v1` store is deleted on first use because its Reader phrase entries keyed on word count and are unsafe.

Speech playback warms the Web Speech voice list at startup and reuses the selected US/UK voice, so pressing Listen does not pay a multi-second voice-discovery cost. The service only cancels the engine when playback is actually pending or speaking.

### Reader state integrity

Reader state lives in one SQLite database, `reader-state.db` in the Reader directory, in WAL mode. Every mutation runs inside `BEGIN IMMEDIATE`, which takes the write lock before the state is read, so the development server and the scheduled task cannot both read one version, compute independent mutations and overwrite each other. A failed read always raises an error; it never falls back to a process's in-memory copy, because that copy is what would silently resurrect lost data. Reads on the request path adopt the newest committed state first, so the UI never serves the snapshot a long-lived process happened to load at startup.

An existing `reader-state.json` is imported exactly once on first start and kept as the operator's record; a later edit to it is not adopted. Permitted article bodies live in the same database, so a body and its metadata commit or roll back together, and nothing outside a permitted record is ever persisted. `ReaderStore.close()` releases the file, which the one-shot scheduled task does at exit.

### Reader run ownership

A collection attempt is owned by the process running it, through a claim recorded with the attempt in the same transaction and refreshed by a heartbeat. Only one process can hold a claim, so two simultaneous "Collect now" presses, or a scheduled run racing a manual one, resolve to a single collection. A process that starts while another process's run is live leaves that run alone: it is not failed, not recovered and not duplicated. An attempt whose owner stopped heartbeating is treated as an orphan after the claim window lapses, and only then is it recovered and its occurrence made schedulable again — so a crash is repaired without a live peer ever being interrupted.

### Reader collection recovery

Collection work lives in memory, so after an unexpected service restart any attempt still stored as `RUNNING` is orphaned: nothing will ever finish it, while the scheduler and manual runs both refuse to start while one exists. On startup the service marks those attempts failed (retryable) and returns their occurrence to a schedulable state exactly once, which is idempotent and leaves issues, editions, delivered articles and reading progress untouched. Reconciliation never leaves an occurrence `RUNNING` without a live attempt.

Recovery never collects early. When the configured collection time is still ahead, an interrupted run leaves the schedule exactly as it was and the day is collected at its own time; catch-up happens immediately only once that time has passed.

An occurrence is only `COMPLETED` when its Daily Issue actually reached `COMPLETE`. A run that finishes without fulfilling the issue stays inside the bounded retry budget (5 then 15 minutes, at most three scheduled attempts) and is only `EXHAUSTED` when that budget is spent, so a finished attempt is never confused with a successful delivery.

### Daily scheduling

The daily collection does not depend on a browser window or on the Vite development server staying alive. Exactly one owner exists: the Windows scheduled task `SayIt Reader Collection`, which runs `server/reader/scheduler-main.ts` every ten minutes through the bundled `vite-node`.

```powershell
pwsh -File scripts/register-reader-task.ps1            # create or update the task
pwsh -File scripts/register-reader-task.ps1 -RunNow    # trigger one run now
pwsh -File scripts/register-reader-task.ps1 -Remove    # remove it
```

Each invocation is one bounded decision against the existing occurrence and attempt records, so extra invocations are no-ops: a completed issue becomes `ALREADY_FULFILLED`, a run already `RUNNING` is never started twice, and a retry that is not due keeps its time. It only reads today's issue and never triggers an LLM call unless a collection is genuinely due. Every run appends one line to `%LOCALAPPDATA%\SayIt\Reader\scheduler.log`, so a missed or crashed schedule leaves evidence instead of disappearing. The development server sets `scheduleRuns: false`: it still recovers interrupted runs, still catches up an already-overdue date when it starts, and still serves manual runs, but it never arms a competing timer.

A dated recovery of an earlier, unfulfilled issue is available explicitly and never touches a delivered one:

```powershell
npx vite-node server/reader/scheduler-main.ts --backfill 2026-10-09 --json
```

A dated recovery only accepts articles the publisher states were published on or before the named date, and refuses an article whose publication date its page does not state. Discovery always runs at the present moment, so without that bound a newly published article could be presented as an older day's reading.

### Article supply and difficulty

FKGL is an approximate reading-difficulty estimator, not proof that a text is unsuitable, so it guides selection instead of gating it. An article within one difficulty tier of the saved preference is eligible and the article nearest the saved difficulty is chosen first, so the tolerance never displaces a better match within the daily reading budget. An article two tiers away is still refused, and Reader reports the shortage rather than padding the issue.

### Reader navigation

Reader has three explicit states: `LATEST_ISSUE_LIST`, `READING_ARTICLE`, and `VIEWING_HISTORICAL_ISSUE`. It opens on the latest scheduled issue, which is the most recent date whose configured collection time has already passed, so before today's collection time that is yesterday. When that issue delivered nothing, Reader says so plainly and offers the most recent delivered issue underneath, dated as itself.

`sayit.reader.last-opened.v1` is a bookmark, not an instruction: an explicitly closed article is never reopened because an old pointer exists. Switching workspaces keeps the in-memory view, so an article left at paragraph 20 comes back at paragraph 20, while the issue list stays the issue list. Article bodies already loaded in a session are reused, so reopening the same article in the same session makes no further request, and no restricted content is persisted for speed.

### History navigation

The top-right History icon opens one shared drawer in both workspaces, with two sections and a stable position:

- **Reading** — Daily Issues, their delivered articles and reading progress;
- **Expressions** — the SayIt query and interpretation history recorded by either workspace.

The drawer defaults to the section belonging to the active mode and can switch sections without switching workspaces. The Reading section has one global `Latest` / `Back to latest` action instead of a Today button on every row, and only the actual current calendar date is labelled Today; a date heading otherwise shows the issue's own date, with `Latest` marking the latest scheduled one. Opening History never changes the mode or the reading position; opening an expression while reading shows a preview panel and leaves the main SayIt input, result and session untouched (the drawer offers "Open in SayIt" for that); opening a reading article from SayIt deliberately switches to Reader, closes the drawer and preserves the SayIt state; closing History dismisses its preview and restores the exact previous workspace and position. The two storage models stay separate.

Reader also dismisses its selection popover when it is deactivated, and invalidates pending selection work, so a popover can never float over SayIt and a late SayIt response cannot recreate one while SayIt is on screen.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

The app does not persist queries automatically. Saved expressions stay in this browser's localStorage.
