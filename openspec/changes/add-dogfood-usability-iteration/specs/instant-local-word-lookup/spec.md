## Purpose

在解释性英文段落内，通过 hover/tap 即时展示词形、本地 IPA、Listen 与 **短英文词典释义**，保持英语沉浸；不调用 LLM、不新增网络请求。

## ADDED Requirements

### Requirement: Lexical hover SHALL apply only to explanatory English blocks

词级交互 MUST 仅启用于 Meaning in this context、Usage / reference、Example 与 Explanation 的英文正文。Primary expression、alternatives、UI labels 与 History/Saved 列表 MUST NOT 启用该 hover 行为。

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

在约 **300 ms** hover 阈值后，tooltip MUST 显示：

1. 选中的 lexical unit  
2. 当前 US/UK accent 下的 IPA（本地 `getIPA`；不可用则省略 IPA 行）  
3. 与 elsewhere 相同的 Listen（Web Speech，朗读该 unit）  
4. **English-only dictionary definition**：短英文释义，非中文翻译  

Tooltip SHOULD 在本地数据可用时 **无网络延迟** 出现；不得调用 DeepSeek 或 `/api/gloss`。

#### Scenario: Example tooltip content

- **WHEN** 用户 hover 词 “gag”
- **THEN** tooltip MAY 显示 `gag`、`/ɡæɡ/`、Listen，以及类似 “a joke or funny trick” 的短英文定义

#### Scenario: No Chinese

- **WHEN** 本地词典或 UI 渲染定义
- **THEN** 系统 MUST NOT 显示中文或“翻译”标签

### Requirement: Definitions SHALL stay short and dictionary-like but not encyclopedic

释义 MUST 为英英、简单英文，优先 **一条** 常见义项；若确有第二常用义项，MAY 再显示 **至多一条** 短补充义项。MUST NOT 展示长义项列表、词源、同义词树或非必要例句。若无可用定义，tooltip MAY 仍显示 word、IPA 与 Listen。

#### Scenario: Missing definition

- **WHEN** 本地词典无该 lemma
- **THEN** tooltip MUST 仍可提供 IPA（若有）与 Listen，且 MUST NOT 阻塞阅读

### Requirement: Definitions SHALL use a local deterministic dictionary adapter

系统 MUST 提供 `getDefinition(lemma)`（或等价 adapter），从 **本地/离线** 英文词典数据源读取；不得通过 LLM 生成释义，不得在 `/api/retrieve` 响应中批量携带词义。

#### Scenario: No gloss API

- **WHEN** 用户 hover 任意词
- **THEN** 客户端 MUST NOT 请求 `/api/gloss` 或 DeepSeek

### Requirement: Reading surface MUST stay visually clean

Lexical unit MUST NOT 默认呈现为明显超链接样式。hover/focus 时 MAY 显示 subtle highlight。每个词 MUST NOT 成为独立 keyboard tab stop。

#### Scenario: Keyboard navigation

- **WHEN** 用户仅用 Tab 键浏览页面
- **THEN** focus order MUST NOT 逐词遍历解释段落

### Requirement: Touch behavior remains lightweight

Touch 设备上，单击 lexical unit SHALL 打开 tooltip；单击外部或 Escape SHALL 关闭 tooltip。

#### Scenario: Tap to open on touch

- **WHEN** 用户在 touch 设备上 tap 一个词
- **THEN** tooltip MUST 打开并可用 Listen
