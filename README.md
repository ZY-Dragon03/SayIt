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

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

The app does not persist queries automatically. Saved expressions stay in this browser's localStorage.
