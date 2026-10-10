# Reader supply funnel analysis (read-only)

Reads the committed Reader traces and reports, per publisher and per stage, how
candidates were discovered and why they did not become readable articles.

```powershell
node scripts/reader-supply-funnel/funnel.cjs
```