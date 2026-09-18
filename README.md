# SayIt

SayIt turns messy English thoughts into natural words, phrases, chunks, and sentences.

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
DEEPSEEK_MODEL=deepseek-chat
DEEPSEEK_BASE_URL=https://api.deepseek.com
```

Then start SayIt:

```powershell
npm run dev
```

Open the local URL printed by Vite. Type a rough English thought and press Enter. Use Shift+Enter for a new line.

## Verification

```powershell
npm run typecheck
npm test
npm run build
```

The app does not persist queries automatically. Saved expressions stay in this browser's localStorage.
