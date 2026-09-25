## Purpose

在解释性英文段落内，通过 **pointer hover / touch tap** 即时展示词形、本地 IPA、Listen 与 **短英文词典释义**（词典原文经 trim，非 paraphrase）；不调用 LLM；hover 路径零 DeepSeek、零外部 API。

## ADDED Requirements

### Requirement: Lexical hover SHALL apply only to explanatory English blocks

词级交互 MUST 仅启用于 Meaning in this context、Usage / reference、Example 与 Explanation 的英文正文。Primary expression、alternatives、UI labels 与 History/Saved 列表 MUST NOT 启用该 lookup 行为。本能力在 Dogfood 阶段 MUST 以 **pointer/touch** 为主；MUST NOT 要求每个 lexical unit 成为 keyboard tab stop 或逐词 Tab 导航目标。

#### Scenario: Meaning paragraph supports hover

- **WHEN** 用户 hover 或 tap Meaning 段落中的英文词
- **THEN** 系统 MAY 显示 local word lookup tooltip

#### Scenario: Expression title does not

- **WHEN** 用户 hover interpret 的 Expression 标题
- **THEN** 系统 MUST NOT 显示词典 tooltip

### Requirement: Word segmentation SHALL use Intl.Segmenter with English refinements

客户端 MUST 使用 `Intl.Segmenter`（word granularity）作为基础，并对 contraction、含 apostrophe 形式及常见 hyphenated lexical unit 做小幅英文后处理。分段 MUST NOT 退化为仅按空格 split。

#### Scenario: Contraction as one unit

- **WHEN** 段落包含 “don't”
- **THEN** hover 目标 SHOULD 为整词 “don't” 而非 “don”

### Requirement: Tooltip SHALL show word IPA Listen and English definition locally

在约 **300 ms** pointer hover 阈值（或 touch tap）后，tooltip MUST 显示：

1. 选中的 lexical unit（surface form）  
2. 当前 US/UK accent 下的 IPA（本地 `getIPA`；不可用则省略 IPA 行）  
3. 与 elsewhere 相同的 Listen（Web Speech，朗读该 unit）  
4. **English-only dictionary definition**：来自本地词典的 **原文措辞**，经允许的 trim 后展示；非中文翻译  

Hover/tap 路径 MUST NOT 调用 DeepSeek、`/api/gloss` 或任何 **外部 API**。浏览器 MAY lazy 加载 **同源静态** 词典 chunk；加载完成后 lookup MUST 为本地同步查表。

#### Scenario: Example tooltip content

- **WHEN** 用户 hover 词 “gag” 且词典已加载
- **THEN** tooltip MAY 显示 `gag`、`/ɡæɡ/`、Listen，以及经 trim 的词典原文释义（例如 WordNet 首分句 `a humorous anecdote or remark intended to provoke laughter` 或其长度截断形式），MUST NOT 依赖 LLM paraphrase（例如 MUST NOT 要求显示 “a joke or funny trick” 除非该字符串来自词典条目本身）

#### Scenario: No Chinese

- **WHEN** 本地词典或 UI 渲染定义
- **THEN** 系统 MUST NOT 显示中文或“翻译”标签

### Requirement: Definitions SHALL stay short and dictionary-like but not encyclopedic

释义 MUST 为英英、优先 **一条** sense；MAY 再显示 **至多一条** 补充 sense。展示文本 MUST **保留词典措辞**；本地处理 MAY 选择 sense、去掉元数据前缀、截断 `;` 后分句、并在词边界施加长度上限。MUST NOT 用确定性规则将 gloss **语义改写** 为任意 learner-friendly 英文。MUST NOT 展示长义项列表、词源、同义词树或非必要例句。若无可用定义，tooltip MUST 仍显示 word、IPA 与 Listen。

#### Scenario: Missing definition

- **WHEN** 本地词典无该 resolved lemma
- **THEN** tooltip MUST 仍可提供 IPA（若有）与 Listen，且 MUST NOT 阻塞阅读

### Requirement: Dictionary lookup SHALL resolve surface form to lemma without LLM

客户端 MUST 对 hover 选中的 surface token 先 **exact normalize** 查词典；未命中时 MUST 按固定顺序应用 **确定性英文词形 fallback**（含常见 plural、`-s`/`-es`、`-ed`、`-ing` 及小型 irregular 表）。MUST NOT 使用 LLM lemmatizer。

#### Scenario: Inflected forms resolve

- **WHEN** 用户 hover `granted`, `uses`, `referencing`, `kicked`, 或 `children` 且词典含对应 lemma
- **THEN** `resolveLemma` MUST 分别解析为可命中的 lemma（如 `grant`, `use`, `reference`, `kick`, `child`）并返回定义（若存在）

#### Scenario: Exact token wins

- **WHEN** surface form 本身为词典 lemma（如 `gag`）
- **THEN** 系统 MUST 优先使用 exact lookup，无需 morphology fallback

### Requirement: Definitions SHALL use a local deterministic dictionary adapter

系统 MUST 提供 `getDefinition(resolvedLemma)`（或等价 adapter），从 **本地/离线** 英文词典数据源读取；不得通过 LLM 生成释义，不得在 `/api/retrieve` 响应中批量携带词义。Compact lexicon MUST 通过 **可复现生成脚本 + manifest**（频率源、license、版本、实测体积）产出；OpenSpec 实现 gate MUST NOT 将 generated lexicon 视为已批准，直到 **至少一次** 生成 artifact 完成 coverage 与 bundle 测量。

#### Scenario: No gloss API

- **WHEN** 用户 hover 任意词
- **THEN** 客户端 MUST NOT 请求 `/api/gloss`、DeepSeek 或其他外部释义 API

### Requirement: Dictionary chunk loading SHALL prefetch on idle and degrade gracefully

当解释性文本块 **首次渲染** 时，客户端 SHOULD 使用 `requestIdleCallback`（或等价 idle 调度）prefetch lazy 本地词典 chunk。在 chunk **尚未** 可用时，300 ms hover/tap MUST 仍打开含 word、IPA、Listen 的 tooltip；定义 MAY 省略或显示非阻塞 loading 态；chunk 就绪后 MUST 可补全同 lemma 定义。

#### Scenario: Hover before dictionary ready

- **WHEN** 用户在词典 chunk load 完成前 hover 一词
- **THEN** tooltip MUST 显示 surface form 与 Listen（及 IPA 若可得），且 MUST NOT 发起外部 API 请求

### Requirement: Reading surface MUST stay visually clean

Lexical unit MUST NOT 默认呈现为明显超链接样式。pointer hover / `:focus-within` 时 MAY 显示 subtle highlight。每个词 MUST NOT 成为独立 keyboard tab stop；tooltip 内 Listen 等控件 MAY 可聚焦。

#### Scenario: Keyboard navigation

- **WHEN** 用户仅用 Tab 键浏览页面
- **THEN** focus order MUST NOT 逐词遍历解释段落中的 lexical unit

### Requirement: Touch behavior remains lightweight

Touch 设备上，单击 lexical unit SHALL 打开 tooltip；单击外部或 Escape SHALL 关闭 tooltip。

#### Scenario: Tap to open on touch

- **WHEN** 用户在 touch 设备上 tap 一个词
- **THEN** tooltip MUST 打开并可用 Listen
