## Context

SayIt 已有：同源 `POST /api/retrieve`、union `SayItResult`、最多 3 轮客户端 session context、右侧 Saved 抽屉与 `sayit.saved.v1`（当前仅持久化 retrieve 成功快照）、本地 `getIPA` + Web Speech、解释性区块上分散的 `action-block` / `natural-sentence` / `explanation` 样式。

本变更在 Dogfood 层增加自动 History、解释区块 UI 统一、以及解释段落内的 **instant local word lookup**（本地 IPA + 本地英英释义）。不改变 retrieve/interpret 的主语义契约字段；hover **不得** 调用 LLM 或新增 API。

## Goals / Non-Goals

**Goals:**

- History 与 Saved 并列且概念清晰：自动 vs  intentional curation。
- 历史恢复可继续 refinement，且 IPA/口音/theme 遵循**当前**客户端状态。
- 解释性区块视觉与 Listen/Copy 行为一致。
- 词级 hover 保持阅读面干净；释义为短 **英英 dictionary definition**，强化英语沉浸。
- IPA、playback、definition 均 deterministic/local；hover 路径 **零 DeepSeek、零外部 API**（允许浏览器 lazy 加载本地静态词典 chunk；加载完成后查表无额外请求）。

**Non-Goals:**

- 中文翻译、词典式多义项、账户/云同步、Production Hardening。
- 在 `/api/retrieve` 中批量返回词义；为 hover 增加 `/api/gloss` 或任何 LLM 释义。
- 将每个 lexical unit 做成 keyboard tab stop 或完整键盘词表导航；复杂 touch 手势系统。
- 词级 lookup 在本 change 定位为 **pointer/touch Dogfood 增强**，不承诺全词可键盘聚焦。
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

### 4. Instant local word lookup — 分段与命中

**范围**：仅 `meaning_in_context`、`usage_or_reference`、`example`、retrieve 的 `short_explanation`（Explanation）四类纯文本 props。

**分段 pipeline**：

1. `Intl.Segmenter`（`locale: en` 或 `en-US`，`granularity: "word"`）生成 segments。
2. 后处理（小规则表）：
   - 保留带 apostrophe 的 contraction 为一个 unit（若 segmenter 拆开则 merge：`don't`, `it's`）。
   - hyphenated token（`co-worker`）优先整段；若 segmenter 仅给出 `co` 则 merge 相邻含 `-` 的 span。
   - 跳过纯标点/空白 segment；数字可选跳过 hover（默认 **可** hover 若 segmenter 标为 word）。
3. 渲染：每个 lexical unit 为 `<span class="lexical-unit" data-start data-end>`，**默认**无下划线；`:hover`/`:focus-within` 时 subtle background/underline。

**输入与可访问性（Dogfood）**：

- 词级 lookup 为 **pointer/touch 增强**：hover（桌面）与 tap（touch）为主路径；**不** imply 每个 lexical unit 可 Tab 聚焦或逐词键盘导航。
- 不对每个词 `tabIndex={0}`；tooltip 打开后其内 Listen 等控件 **可** 聚焦。
- `aria-describedby` 仅在 tooltip 打开时挂到当前词（可选）。

**Touch（Dogfood 最小方案）**：单击词打开 tooltip；单击外部或 Escape 关闭；不引入 long-press 与双次 tap 竞争。

**Hover 时序**：pointer enter → **300 ms** timer → 打开 tooltip；leave 取消 timer；移入 tooltip 不立即关闭（短 grace）。

### 5. Tooltip 内容与定义行为

```
┌─────────────────────────────┐
│ gag                         │
│ /ɡæɡ/  [Listen]             │
│ a humorous anecdote or …    │  ← 词典原文 + trim，非 paraphrase
│ (optional 2nd sense line)   │
└─────────────────────────────┘
```

- 显示 lexical unit + 本地 IPA（`getIPA(unit, accent)`）+ Listen + **本地 definition**。
- 定义 **英英**、简单、通常一行；优先最常见义项；最多 **再一条** 短补充义项。
- 禁止：长义项列表、词源、同义词树、非必要例句、中文。
- 无定义时：仍显示 word / IPA / Listen（可用部分）。

**Adapter**（与 `getIPA` 对称）：

```ts
getDefinition(lemma: string): Promise<{
  primary: string;
  secondary?: string;
} | null>
```

**Surface-form → lemma（无 LLM）**：

1. **Exact**：对 normalize 后的 surface token（NFKC、trim、小写、strip 边缘标点）先查词典。
2. **Morphology fallback**：未命中时按 **确定性英文词形规则** 依次尝试候选 lemma（同一 token 内顺序固定、可单测）：
   - 不规则表（小集合，如 `children→child`, `went→go`, `granted→grant` 等 Dogfood 高频 irregular）
   - `-ies` → `-y`；`-es`/`-s` 去复数（含 `-ches`/`-shes`/`-xes`/`-zes`/`-ses` 等规则分支）
   - `-ing` → 去 `-ing` / `-e` 还原 / 双写辅音还原（有限规则，非 Porter 全量）
   - `-ed` → 去 `-ed` / `-e` / 双写辅音还原
   - `-er`/`-est`/`-ly` 等 **本 change 不** 优先覆盖（除非 exact/上述已命中）；避免过度 stemming 误伤
3. 第一个命中定义的 candidate 即为 lookup key；全部失败 → `null`（tooltip 仍 IPA+Listen）。

**单元测试用例（adapter / lemmatizer 规则，非 LLM）**：`granted`→`grant`, `uses`→`use`, `referencing`→`reference`, `kicked`→`kick`, `children`→`child`（外加 `gag`, `don't` exact）。

**Gloss 后处理（非 paraphrase）**：

本地处理 **不得** 声称可用确定性规则把 WordNet gloss **改写** 为任意 “learner-friendly” 英文。允许的操作仅限：

- 选择 **一条**（可选第二条）sense 顺序（词典默认/频率表，非 LLM）
- 去掉 lexicographer 元数据前缀、括号内冗长标注（若数据源带）
- 截断 trailing **`;` 分句**（保留第一分句为主释义）
- 硬 **长度上限**（如 ~120 字符）在词边界截断

**必须保留词典原文措辞**；不做语义 paraphrase（例如 **不要** 把 WordNet 长句 “rewrite” 成 “a joke or funny trick”  unless 该短语本身来自词典条目）。

**Cache**：内存 Map keyed by **resolved lemma**（bounded LRU）；**不**依赖 sentence context。更换词典 engine 时 bump 资源版本（类似 `sayit.ipa.v1` 规则）。

**延迟与 prefetch**：

- Hover 路径：**零** DeepSeek、**零** 外部 API；允许 **一次** lazy `import()` / fetch **同源静态** 词典 chunk（仍无 LLM）。
- 在解释性文本 **首次出现** 时，SHOULD 用 `requestIdleCallback`（或等价 idle 调度）prefetch 词典 chunk，使 300 ms hover 时多数情况下已 resident。
- 词典 **尚未** load 完成时：tooltip MUST 仍显示 word + IPA + Listen；定义行 MAY 省略或显示轻量 “loading definition…”（非阻塞）；load 完成后同 lemma 即时补全。

### 6. Dictionary engine decision gate（bake-off，实现前评审）

隔离测量（Windows/Node + npm metadata；Vite 仅对 JSON 资源做量级估算）：

| 候选 | 体积（约） | 浏览器 | 释义 | 延迟（观测） | 许可 | 结论 |
| --- | --- | --- | --- | --- | --- | --- |
| `dictionary-en@4.0.0` | ~575 KB | Hunspell aff/dic | **无**（拼写） | N/A | MIT+BSD | **不适合** |
| `wordnet@2.0.0` | ~28 MB unpacked | Node 模块 + 数据文件；可 lazy chunk | WordNet gloss，需裁剪 | init ~970 ms；lookup ~0.5–3 ms | MIT | **备选**（覆盖好，体积大） |
| `en-dictionary` + `en-wordnet` | ~70 MB+ | 重 | WordNet | init 重 | MIT | **不适合** browser Dogfood |
| **Generated compact lexicon JSON**（建议 `sayit-lexicon.v1.json`） | 目标 **1–3 MB gzip**（~8k–15k lemmas，**实测为准**） | `import()` lazy；O(1) map | 生成时选定 sense + 保留词典措辞 + 运行时仅 trim | 加载后 **<1 ms** | 见下 **Reproducible generation** | **候选首选**（未测 artifact 前 **不批准**） |

Golden lemmas（Dogfood）：`gag`, `cartoon`, `categorize`, `granted`, `reference`, `literal`, `xyznotaword`；词形：`uses`, `referencing`, `kicked`, `children`.

**Gloss 展示示例（保留词典措辞 + runtime trim，非 paraphrase）**：对 `gag`，WordNet 首 sense 经 **分号截断 + 长度上限** 后可能显示为 `a humorous anecdote or remark intended to provoke laughter`（或生成物中已预选的更短 **词典原文** 分句），**而非** LLM 或规则改写的 “a joke or funny trick”.

### 6.1 Reproducible compact lexicon generation

**词条选择（~8k–15k）** MUST 由 **显式、可复现** 的频率/来源数据决定，例如：

- **Primary frequency list**：公开英文词频表（实现时锁定具体文件与版本，如 SUBTLEX-US / wordfreq “large” 导出 / Google 1-grams 子集之一——在 `scripts/lexicon/README.md` 中写死 URL、checksum、下载日期）。
- **Merge policy**：频率序取 top N（N 在 manifest 中声明，如 12_000）；与 SayIt Dogfood  golden set **并集**；去重 normalize lemma。
- **Sense selection at generation time**：对每个 lemma 从 WordNet 3.0（或选定 OSS 源）取 **默认/最常见 sense** 的 gloss 原文写入 `primary`；可选 `secondary` 为第二条 sense 的 **原文**（同样可预 trim 至第一 `;` 分句，**不在生成阶段 paraphrase**）。

**License / attribution**：生成脚本输出 `sayit-lexicon.manifest.json`（或 `.v1` 内字段）记录：`wordnetVersion`, `frequencySourceName`, `frequencySourceUrl`, `frequencySourceLicense`, `generatedAt`, `gitSha`, `entryCount`, `gzipBytes`（构建后实测）, `sha256`.

**Deterministic generation script**（仓库路径建议 `scripts/generate-sayit-lexicon.ts` 或等价）：

- 输入：锁定的频率文件路径 + WordNet 数据路径（或 npm 包版本 pin）
- 输出：`public/data/sayit-lexicon.v1.json`（或 `src/assets/…`）+ manifest
- CI/本地：`npm run lexicon:generate` 可重复生成；diff 用于 review

**Approval gate（硬）**：OpenSpec **不得** 将 generated compact lexicon 标为 “已批准”，直到 **至少一次** 真实生成 artifact 完成测量并记录：

- gzip / brotli 体积（Vite bundle 或静态文件实测）
- golden + 词形 fallback 用例覆盖率（含 `granted`, `uses`, `referencing`, `kicked`, `children`）
- 随机 100 词 spot-check 可读性（仍为词典原文）

**Recommendation（评审门）**：

1. **候选首选**：上述 **generated compact lexicon** + manifest + 生成脚本；**实测通过后** 再锁定为唯一数据源。
2. **若覆盖率/体积不达标**：fallback **`wordnet@2.0.0` lazy chunk**（私有 Dogfood 可接受 ~28MB），runtime gloss 处理仍遵守 **非 paraphrase** 规则。
3. **不选**：`dictionary-en`（无释义）、`en-wordnet` 全量（过大）、任何 `/api/gloss`、LLM lemmatizer。

实现 change 在 **词典 artifact 测量 + 来源评审通过** 后再锁定依赖或生成物；OpenSpec 固定架构：`definition → local dictionary`，`IPA → getIPA`，`playback → Web Speech`。

### 8. Session context 与 History 恢复

修改语义（delta spec）：

- 恢复 History **replace** 当前 ephemeral context 为 **单条** 摘要，而非 merge 旧 3 轮。
- 用户随后 submit 新输入时，现有 `slice(-MAX_SESSION_TURNS)` 逻辑照常；第一条 context 即 restored interaction。
- 从 Saved 加载 **不**改变现有行为（不自动 seed context），除非产品后续统一；本 change 仅规定 History restore。

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| 200 条完整 `SayItResult` 体积 | Zod 校验 + 监控 localStorage quota；失败时 stop append + toast |
| Hover 首次加载词典 chunk | 解释块首次出现时 `requestIdleCallback` prefetch 同源静态 chunk；hover 零外部 API；load 前 tooltip 仍 word/IPA/Listen |
| Segmenter 浏览器差异 | 特性检测；不支持时整段不启用 hover（graceful degrade） |
| 定义过长或多义 | adapter 裁剪 + 最多 primary/secondary 两行 |
| 左/右双 drawer 小屏拥挤 | 全屏 overlay drawer；互斥打开 |
| 像词典应用 | 仅解释性段落、无词表页 |
| 紧凑词表覆盖缺口 | 无定义时仅 IPA+Listen；Dogfood 记录缺口词 |
| 词表 license/attribution | 生成脚本保留 WordNet/数据源说明；公开分发前单独 review |
| History 仅 success 遗漏澄清 | 产品可后续扩展 status 白名单 |

## Migration Plan

1. 实现 History repository + UI（不影响 Saved）。
2. 抽取 `ExplanatoryResultBlock` 并替换四类区块。
3. 锁定词典 artifact 测量通过后实现 segmenter + surface→lemma + tooltip + `getDefinition` + lemma cache。
4. 更新 session-context delta 行为与测试。
5. Dogfood 手动：恢复 Road House interpret → follow-up；hover “gag”；词形 fallback 用例；切换 accent 后 IPA/Listen 一致；确认 hover 无 DeepSeek/外部 API。

本 artifact 为 **设计评审门**；评审通过后再 `/opsx-apply`。
