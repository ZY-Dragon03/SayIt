# SayIt Reader Acceptance Plan

> 产品验收基线：49 个冻结 PAT，Product Contract v1.0，冻结 tag `sayit-reader-product-contract-v1.0`，契约 commit `a432b1b00ff1c5c8a733ca45801109948f4e4f62`。此计划只指定验证方式，不改变 PAT 含义。

## Candidate and evidence rules

- 每次验收先记录完整 candidate SHA、Node/npm 版本、OS/browser、Reader service version 和时间；同一轮 49 项必须绑定同一个集成 candidate。
- 结果文件位于 `artifacts/product-acceptance/reader/`。`report.json` 逐项记录 PAT、PASS/FAIL/NOT-RUN、运行方式、输入/偏好、结果和 evidence path；trace 不包含 API key、proxy credential 或用户本地秘密。
- 用 clock-controlled scheduler/domain tests 验证日历、计划、重试和 catch-up。产品浏览器案例用实际 SayIt UI 与同一候选服务验证；单测不能替代有实际 UI 要求的案例。
- PAT-RC-07 必须至少进行一次真实动态网络 collection：只传保存偏好、不传 article URL 列表；保存查询和候选决策 trace，并确认最终全文由动态发现的页面抓取取得。
- PAT-RH-14 必须从真实 Reader article selection 发起现有 SayIt interpretation provider 请求；记录已脱敏 request summary、provider response mode/status 和文章上下文摘要，不保存 key。Mock 与 fixture 不计入这两条实时验收。
- 对网络阻断、无合法全文、授权缺失或无法访问的内容诚实计为拒绝/短缺；不得通过更改产品接受含义、把摘要当全文或以 mock 改写真实案例来获得 PASS。

## PAT-to-evidence mapping

| PAT | Candidate-bound verification | Evidence expected |
| --- | --- | --- |
| PAT-RM-01 | Browser UI: default Reader flag off | SayIt primary workspace visible; Reader view absent |
| PAT-RM-02 | Browser UI: activate Reader from SayIt | Reader appears; existing SayIt data remains unchanged |
| PAT-RM-03 | Browser UI: active Reader with no open article | Daily list visible; hidden SayIt input cannot be operated |
| PAT-RM-04 | Browser UI: open an issue article | Immersive article body visible; primary SayIt work surface hidden |
| PAT-RM-05 | Browser UI: seed SayIt input/result/context, enter Reader, interpret, close | Same primary input/result/context restored |
| PAT-RM-06 | Browser UI + service restart: deactivate and reactivate Reader | Preferences, archive, and progress remain |
| PAT-RC-01 | Preferences UI + API persistence round trip after service restart | All six configured values equal saved values |
| PAT-RC-02 | Scheduler fake clock at 09:00 for 18:00 preference | WAITING occurrence; zero attempts; no discovery call |
| PAT-RC-03 | Scheduler fake clock crosses 18:00 while Reader UI is unmounted | Scheduled attempt and persisted issue state appear when UI opens |
| PAT-RC-04 | Persist occurrence, advance clock past plan, restart service | Current date catch-up preserves planned and actual times |
| PAT-RC-05 | Inject transient failures with fake clock | Exactly initial + at most two retry attempts at configured delays; permanent candidate failure is not retried |
| PAT-RC-06 | Manual run before due time with fake clock | Same issue identity; occurrence time and scheduled retry budget unchanged |
| PAT-RC-07 | Live network run from saved preferences only | Query, discovered candidates, decisions, and delivered body trace; initial Agent input contains no article URLs |
| PAT-RC-08 | Curation fixtures with same URL, body hash, syndicated and mirror copies | One occupied issue slot and explicit duplicate reasons |
| PAT-RC-09 | Original source fixture returns 403; candidate replacement is found | Original/accessibility attribution separated; unverifiable copy excluded |
| PAT-RC-10 | Replacement article fixture with different publication metadata | Replacement appears under its own publication and accessible URL |
| PAT-RC-11 | Disconnect/inject network error during manual or scheduled run | Attempt failure visible; existing issue/archive remains readable |
| PAT-RC-12 | Discovery fixtures provide fewer eligible full texts than target | Explicit PARTIAL/NOT_DELIVERED with delivered counts and unmet constraints |
| PAT-RC-13 | Curation fixture satisfies topics, count, difficulty, and budget | COMPLETE only at exact count and 70%–100% budget range |
| PAT-RC-14 | Candidate fixture set cannot satisfy every constraint | PARTIAL/NOT_DELIVERED; preferences unchanged; no unsuitable padding |
| PAT-RC-15 | Summary-only candidate fixture | Rejected from full-text count and budget; search continues |
| PAT-RC-16 | Candidate succeeds in search then returns 404/403 at fetch | Rejected and replaced or explicit shortage; never delivered as full text |
| PAT-RC-17 | Manual run fills target before scheduled fake-clock due time | Occurrence ALREADY_FULFILLED; no discovery attempt; one issue identity |
| PAT-RC-18 | Manual run creates partial issue, scheduled run adds eligible fixtures | One issue progresses PARTIAL to COMPLETE without duplicate article |
| PAT-RC-19 | Multiple manual runs with a future occurrence and unused scheduled retries | Future date/time and scheduled retry count unchanged |
| PAT-RC-20 | Manual run against COMPLETE issue through UI | Regenerate confirmation shown; current articles/progress retained |
| PAT-RC-21 | Explicit Regenerate against COMPLETE issue | Same date identity; edition increments; prior edition remains accessible |
| PAT-RC-22 | Restart service before due time with fake clock | Occurrence remains WAITING and does not catch up early |
| PAT-RC-23 | Advance fake clock seven dates and restart | Prior six occurrences MISSED; only current date can execute |
| PAT-RC-24 | Fake clock across timezone DST gap and overlap | One local-date occurrence; gap moves to first valid time; overlap fires once |
| PAT-RC-25 | Open issue/article metrics view for deterministic fixture | Word/syllable/sentence inputs, 200 wpm and FKGL result match recomputation |
| PAT-RC-26 | Same-event independent reporting + analysis fixtures | Both remain eligible with separate source and independence rationale |
| PAT-RC-27 | Near-duplicate fixture with 5-word-shingle Jaccard ≥0.85 and no independent addition | One retained article and similarity rationale |
| PAT-RC-28 | Same event/topic fixtures with low body similarity and independent substance | Both remain eligible; shared event alone does not deduplicate |
| PAT-RH-01 | Browser UI: open article from daily list | Article body, source, estimate, and reading state visible |
| PAT-RH-02 | Browser selection toolbar/action with supported SayIt capabilities | Selection result plus existing IPA/Listen/Save/Copy actions available |
| PAT-RH-03 | Browser UI: invoke action with empty selection | No retrieval request; article position unchanged |
| PAT-RH-04 | Browser UI: interpret selection mid-article then close result | Same article and position restored; main SayIt result unchanged |
| PAT-RH-05 | Browser UI + service restart after reading | Reading progress and article position restored |
| PAT-RH-06 | Browser UI: open an earlier date in archive | Past date, articles, progress, and attribution visible |
| PAT-RH-07 | Reader SayIt success then open SayIt history | Successful Reader interpretation appears/restores as standard SayIt history |
| PAT-RH-08 | Browser offline mode with previously stored metadata | Archive and progress remain visible; unavailable new collection is distinguished |
| PAT-RH-09 | Browser UI open an issue article marked FULL_TEXT | Continuous readable body paragraphs appear, not title/summary only |
| PAT-RH-10 | Leave Reader and reopen it after stored mid-article position | Prior article and scroll/progress position restored |
| PAT-RH-11 | Seed explicitly cache-permitted full body, go offline, open archive item | Cached body and position render offline; noncached entries remain external-only |
| PAT-RH-12 | Browser UI inspect a summary/external-only candidate | Candidate clearly marked external/summary and excluded from issue count |
| PAT-RH-13 | Browser select a dictionary-known single word | Existing local definition, IPA, and Listen path used; no phrase interpretation request |
| PAT-RH-14 | Browser select a phrase/sentence in a live delivered article | Existing `/api/retrieve` interpretation handles selection with nearby article context; primary workspace remains unchanged |
| PAT-RH-15 | Browser/service: read article, regenerate, inspect archived editions | Old edition/article/progress retained; matching article carries progress forward |

## Execution owners

- Engineering automation creates focused Vitest coverage for schemas, storage, scheduling, discovery/extraction, curation, API, and component behavior.
- Integrator runs full `npm test`, `npm run typecheck`, `npm run build`, and integrated lifecycle/network scenarios before candidate handoff.
- A separate read-only Acceptance Engineer runs the 49 PATs against one final integrated candidate, records evidence, and does not repair implementation.
- Any remediation invalidates only evidence whose relevant code or candidate changed; affected cases are rerun and report identity is updated to the new candidate SHA.
