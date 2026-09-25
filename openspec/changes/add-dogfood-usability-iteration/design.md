## Context

SayIt 已有：同源 `POST /api/retrieve`、union `SayItResult`、最多 3 轮客户端 session context、右侧 Saved 抽屉与 `sayit.saved.v1`（当前仅持久化 retrieve 成功快照）、本地 `getIPA` + Web Speech、解释性区块上分散的 `action-block` / `natural-sentence` / `explanation` 样式。

本变更在 Dogfood 层增加自动 History、解释区块 UI 统一、以及解释段落内的 contextual gloss。不改变 retrieve/interpret 的主语义契约字段；gloss 为独立、按需、小请求能力。

## Goals / Non-Goals

**Goals:**

- History 与 Saved 并列且概念清晰：自动 vs  intentional curation。
- 历史恢复可继续 refinement，且 IPA/口音/theme 遵循**当前**客户端状态。
- 解释性区块视觉与 Listen/Copy 行为一致。
- 词级 hover 保持阅读面干净；gloss 为短英文 contextual gloss，强化英语沉浸。
- IPA 与 playback 完全 deterministic/local；gloss  alone 走轻量 DeepSeek（或等价）路径。

**Non-Goals:**

- 中文翻译、词典式多义项、账户/云同步、Production Hardening。
- 在 `/api/retrieve` 中批量返回词义或 IPA。
- 为每个词增加 keyboard tab stop；复杂 touch 手势系统。
- 修改 Saved 为自动写入 History 的替代品（两者并存）。

## Decisions

### 1. Local History 数据模型

**Envelope**（建议 `sayit.history.v1`）：

```json
{
  "version": 1,
  "items": [ /* newest-first or oldest-first with trim policy */ ]
}
```

**Record**（每条）：

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | UUID |
| `created_at` | ISO datetime | 客户端写入时间 |
| `input` | string | 原始 “Your thought”，trim 后 ≤500 |
| `result` | `SayItResult` | 完整语义结果；**不含** IPA、gloss、session 快照 |
| `mode` | `"retrieve" \| "interpret"` | 冗余自 `result.mode`，便于列表 UI |

**写入时机**：一次 `/api/retrieve` 请求在 HTTP 200 且 `sayItResultSchema` 校验通过后，若 `result.status === "success"` 则 append。`needs_clarification`、`no_match` 与网络/provider 错误 **不**写入（避免把失败/低价值状态灌满 History）。若 Dogfood 后续需要澄清也进历史，可在实现前单独放宽；本设计默认仅 **success**。

**去重**：与上一条比较 `dedupeKey = normalize(input) + "|" + mode + "|" + stableResultFingerprint(result)`；若相同则 **不**新增记录，可选 `touch` 上一条 `created_at`（实现二选一，默认不 touch，直接 skip）。

**Fingerprint**（轻量）：retrieve 用 `best_match.text` + `natural_sentence`；interpret 用 `interpretation.expression` + `meaning_in_context` 前 120 字符。不 hash 全 JSON 以控成本。

**容量**：最多 **200** 条；超出时丢弃最旧条目。损坏 envelope → 空列表 + 非阻塞提示。

**Repository**：新建 `LocalHistoryRepository`，与 `LocalMemoryRepository` 分离；Saved 继续 `sayit.saved.v1` 且仍只接受 retrieve 成功保存（本 change 不强制 Saved 支持 interpret，除非产品后续要求）。

### 2. History 交互模型

```
Top bar:  [History] ... [Saved] [Theme] [Pronunciation]
                |              |
           left drawer    right drawer (existing)
```

- **History 按钮**：顶栏轻量入口，带可选 count badge（如 ≤99）。
- **抽屉**：从 **左侧** 滑入（`history-drawer`）；Saved 保持右侧；两层 drawer **不**同时打开（打开一侧关闭另一侧）。
- **列表项展示**（建议）：主标题 = retrieve `best_match.text` 或 interpret `interpretation.expression`；副标题 = 截断的 `input` 或 `natural_sentence`/meaning；时间相对或短日期；小 badge `retrieve` / `interpret`。
- **点击条目**：
  1. 设置 `input` = record.input，`result` = record.result；
  2. 清除 `activeSavedId`、错误态、loading；
  3. **`setSessionContext([])` 然后 append 一条**：`{ input, mode, assistant_summary: summarizeResult(result) }`（仅这一条，**不**恢复历史多轮）；
  4. 关闭 History 抽屉；
  5. 触发既有 IPA `useEffect`（按当前 accent 对 expression 字段 re-lookup）；
  6. **不**修改 `sayit.theme` / `sayit.pronunciation.v1`。
- **不提供** History 内 Delete-all 作为 MVP 必需项；可选单条删除或 “Clear history” 作为小增强（tasks 中列为 SHOULD）。

与 Saved 对比：

| | History | Saved |
| --- | --- | --- |
| 触发 | 自动（success） | 用户 Save |
| 容量 | ~200 | 500 |
| 结果类型 | 完整 `SayItResult` | retrieve 快照 |
| 目的 | 时间线回忆 | 长期收藏 |

### 3. Unified explanatory result block

抽取 **`ExplanatoryResultBlock`**（名称可微调）：

- Props：`kicker`, `text`, `speechKey`, `copyLabel`, handlers（onSpeak/onCopy）、现有 contextual action 状态 props。
- 统一 class：`explanatory-result-block action-block`（替换 `natural-sentence` / `explanation` 在解释性场景下的分叉）。
- Example 不再使用单独弱化的 `explanation` 视觉层级；与 Meaning/Usage 相同 surface。
- **不**改变 `SayItResult` JSON；仅 React/CSS 重构。

### 4. Contextual word hover — 分段与命中

**范围**：仅 `meaning_in_context`、`usage_or_reference`、`example`、retrieve 的 `short_explanation`（Explanation）四类纯文本 props。

**分段 pipeline**：

1. `Intl.Segmenter`（`locale: en` 或 `en-US`，`granularity: "word"`）生成 segments。
2. 后处理（小规则表）：
   - 保留带 apostrophe 的 contraction 为一个 unit（若 segmenter 拆开则 merge：`don't`, `it's`）。
   - hyphenated token（`co-worker`）优先整段；若 segmenter 仅给出 `co` 则 merge 相邻含 `-` 的 span。
   - 跳过纯标点/空白 segment；数字可选跳过 hover（默认 **可** hover 若 segmenter 标为 word）。
3. 渲染：每个 lexical unit 为 `<span class="lexical-unit" data-start data-end>`，**默认**无下划线；`:hover`/`:focus-within` 时 subtle background/underline。

**可访问性**：

- 不对每个词 `tabIndex={0}`；tooltip 内 Listen/Copy 可聚焦。
- `aria-describedby` 仅在 tooltip 打开时挂到当前词（可选）。

**Touch（Dogfood 最小方案）**：单击词打开 tooltip；单击外部或 Escape 关闭；不引入 long-press 与双次 tap 竞争。

**Hover 时序**：pointer enter → **300 ms** timer → 打开 tooltip；leave 取消 timer；移入 tooltip 不立即关闭（短 grace）。

### 5. Tooltip 内容与加载顺序

```
┌─────────────────────────────┐
│ gag                         │
│ /ɡæɡ/  [Listen]             │
│ a repeated joke   (loading…)│
└─────────────────────────────┘
```

- **T0**：显示 lexical unit + 本地 IPA（`getIPA(unit, accent)`，单词/短语级；失败则隐藏 IPA 行）+ Listen（Web Speech，原文 unit）。
- **T0+**：若 cache miss，发起 gloss 请求；pending 时第三行 skeleton 或 “…”。
- **禁止**中文；UI  copy 使用 “contextual gloss” 而非 “translation”。

### 6. Contextual gloss API 契约

**Endpoint**：`POST /api/gloss`（同源 Vite middleware，与 retrieve 相同 secret 边界）。

**Request**（Zod）：

```json
{
  "word": "gag",
  "context": "Peter Griffin uses it as a running gag referencing the movie."
}
```

| Field | Constraint |
| --- | --- |
| `word` | 1–80 chars，trim；与 UI 选中 unit 一致 |
| `context` | 1–600 chars；**整句**或包含该词的段落（来自当前 block 的全文，非全页） |

**Response**：

```json
{
  "gloss": "a repeated joke"
}
```

| Field | Constraint |
| --- | --- |
| `gloss` | 3–10 英文词（soft validate）；无中文；无 Markdown；单句 |

**Provider 行为**：

- DeepSeek：`thinking: { type: "disabled" }`，`response_format: { type: "json_object" }`，低 `max_tokens`（如 40–80），temperature 低。
- System prompt：要求 **contextual gloss in simple English for this sentence only**；禁止词典多义项、禁止中文、禁止 IPA。
- 失败 → `{ "error": { "code", "message", "retryable" } }` 或 HTTP 502；tooltip 保留 word/IPA/Listen，gloss 行显示短英文 fallback “Couldn’t load gloss” 或隐藏。

**不**把 gloss 写入 History 或 `SayItResult`。

### 7. Gloss 缓存策略

**Key**：`gloss:v1:${normalize(word)}:${hash(normalize(context))}`  
- `normalize`：NFKC、trim、collapse whitespace、context 截断至 600。  
- `hash`：短 SHA-256 或 FNV 前缀即可（客户端）。

**Store**：内存 LRU（如 256 entries）+ 可选 `sessionStorage` 或 `localStorage` 子键 `sayit.gloss.v1`（bounded）；**不**与 IPA cache 混用。

**In-flight dedupe**：同 key 并发共享 Promise。

**Invalidation**：改 word/context 即新 key；无 server push。

### 8. Session context 与 History 恢复

修改语义（delta spec）：

- 恢复 History **replace** 当前 ephemeral context 为 **单条** 摘要，而非 merge 旧 3 轮。
- 用户随后 submit 新输入时，现有 `slice(-MAX_SESSION_TURNS)` 逻辑照常；第一条 context 即 restored interaction。
- 从 Saved 加载 **不**改变现有行为（不自动 seed context），除非产品后续统一；本 change 仅规定 History restore。

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| 200 条完整 `SayItResult` 体积 | Zod 校验 + 监控 localStorage quota；失败时 stop append + toast |
| Hover gloss 请求过多 | 300 ms 门槛 + cache + 取消离开 hover 的 in-flight |
| Segmenter 浏览器差异 | 特性检测；不支持时整段不启用 hover（graceful degrade） |
| Gloss 质量不稳定 | 短 prompt、context 必填、Dogfood 记录 bad cases；不阻塞阅读 |
| 左/右双 drawer 小屏拥挤 | 全屏 overlay drawer；互斥打开 |
| 像词典应用 | 仅解释性段落、无词表页、无 retrieve 级 gloss |
| 误用中文 | prompt + response Zod 拒绝 CJK |
| History 仅 success 遗漏澄清 | 产品可后续扩展 status 白名单 |

## Migration Plan

1. 实现 History repository + UI（不影响 Saved）。
2. 抽取 `ExplanatoryResultBlock` 并替换四类区块。
3. 实现 segmenter + tooltip + `/api/gloss` + cache。
4. 更新 session-context delta 行为与测试。
5. Dogfood 手动：恢复 Road House interpret → follow-up；hover “gag”；切换 accent 后 gloss/IPA 一致。

本 artifact 为 **设计评审门**；评审通过后再 `/opsx-apply`。
