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

### Reader collection recovery

Collection work lives in memory, so after an unexpected service restart any attempt still stored as `RUNNING` is orphaned: nothing will ever finish it, while the scheduler and manual runs both refuse to start while one exists. On startup the service marks those attempts failed (retryable) and returns their occurrence to a schedulable state exactly once, which is idempotent and leaves issues, editions, delivered articles and reading progress untouched. Reconciliation never leaves an occurrence `RUNNING` without a live attempt.

An occurrence is only `COMPLETED` when its Daily Issue actually reached `COMPLETE`. A run that finishes without fulfilling the issue stays inside the bounded retry budget (5 then 15 minutes, at most three scheduled attempts) and is only `EXHAUSTED` when that budget is spent, so a finished attempt is never confused with a successful delivery.

### History navigation

The top-right History icon opens one shared drawer in both workspaces, with two sections and a stable position:

- **Reading** — Daily Issues, their delivered articles and reading progress;
- **Expressions** — the SayIt query and interpretation history recorded by either workspace.

The drawer defaults to the section belonging to the active mode and can switch sections without switching workspaces. Before the Reader has loaded once, the Reading section is empty and says so. Opening History never changes the mode or the reading position; opening an expression while reading shows a preview panel and leaves the main SayIt input, result and session untouched (the drawer offers "Open in SayIt" for that); opening a reading article from SayIt deliberately switches to Reader and preserves the SayIt state; closing History returns to the exact previous workspace and position. The two storage models stay separate.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

The app does not persist queries automatically. Saved expressions stay in this browser's localStorage.
