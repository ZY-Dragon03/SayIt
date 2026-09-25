## Purpose

在解释性英文段落内，通过轻量 hover/tap 提供词级 IPA、Listen 与 **contextual gloss**（短英文语境释义），保持英语沉浸；不把 SayIt 变成词典应用。

## ADDED Requirements

### Requirement: Lexical hover SHALL apply only to explanatory English blocks

词级交互 MUST 仅启用于 Meaning in this context、Usage / reference、Example 与 Explanation 的英文正文。Primary expression、alternatives、UI labels 与 History/Saved 列表 MUST NOT 启用该 hover 行为。

#### Scenario: Meaning paragraph supports hover

- **WHEN** 用户 hover 或 tap Meaning 段落中的英文词
- **THEN** 系统 MAY 显示 contextual tooltip

#### Scenario: Expression title does not

- **WHEN** 用户 hover interpret 的 Expression 标题
- **THEN** 系统 MUST NOT 显示 contextual gloss tooltip

### Requirement: Word segmentation SHALL use Intl.Segmenter with English refinements

客户端 MUST 使用 `Intl.Segmenter`（word granularity）作为基础，并对 contraction、含 apostrophe 形式及常见 hyphenated lexical unit 做小幅英文后处理。分段 MUST NOT 退化为仅按空格 split。

#### Scenario: Contraction as one unit

- **WHEN** 段落包含 “don't”
- **THEN** hover 目标 SHOULD 为整词 “don't” 而非 “don”

### Requirement: Tooltip SHALL show word IPA Listen and contextual gloss

在约 **300 ms** hover 阈值后，tooltip MUST 显示：

1. 选中的 lexical unit 文本  
2. 当前 US/UK accent 下的 IPA（本地 `getIPA`；不可用则省略 IPA 行）  
3. 与 elsewhere 相同的 Listen 行为（Web Speech，朗读该 unit）  
4. **contextual gloss**：3–10 个简单英文词，解释该词在 **当前句/段语境** 中的含义  

Tooltip MUST NOT 显示中文或“翻译”标签；产品文案 MUST 使用 contextual gloss 术语。

#### Scenario: Immediate shell with lazy gloss

- **WHEN** hover 超过阈值且 gloss 尚未返回
- **THEN** tooltip MUST 先显示 word、IPA（若有）与 Listen，并在 gloss 行显示 loading 或占位

#### Scenario: No Chinese in gloss

- **WHEN** gloss 服务返回含中文文本
- **THEN** 客户端 MUST 丢弃该 gloss 且不展示中文

### Requirement: Gloss SHALL be fetched lazily via /api/gloss

系统 MUST 提供 `POST /api/gloss`，请求体至少包含 `word` 与 `context`（ surrounding sentence/paragraph）。gloss MUST NOT 批量包含在 `/api/retrieve` 响应中。DeepSeek（或等价 provider）SHOULD 使用 non-thinking 模式且仅用于 gloss 生成。

#### Scenario: Gloss request shape

- **WHEN** 用户 hover 词 “gag” 于含该词的 Usage 句子
- **THEN** 客户端 MUST 发送 `{ "word": "gag", "context": "<full usage text>" }` 而非重新调用 retrieve

### Requirement: Gloss and IPA SHALL use separate deterministic and cached paths

IPA MUST 来自现有本地 `getIPA`；playback MUST 来自 Web Speech。Gloss MUST 使用客户端 cache（lexical unit + normalized context key）与 in-flight 去重。IPA cache 版本策略 MUST 保持独立（参见 README `sayit.ipa.v1` 规则）。

#### Scenario: Repeated hover uses cache

- **WHEN** 用户对同一 word 与同一 context 再次 hover
- **THEN** 客户端 MUST NOT 重复请求 `/api/gloss` 若 cache 命中

### Requirement: Reading surface MUST stay visually clean

Lexical unit MUST NOT 默认呈现为明显超链接样式。hover/focus 时 MAY 显示 subtle highlight。每个词 MUST NOT 成为独立 keyboard tab stop。

#### Scenario: Keyboard navigation

- **WHEN** 用户仅用 Tab 键浏览页面
- **THEN** focus order MUST NOT 逐词遍历解释段落

### Requirement: Touch behavior SHALL remain lightweight

在 touch 设备上，单击 lexical unit SHOULD 打开 tooltip；单击外部或 Escape SHOULD 关闭。本 Dogfood 迭代 MUST NOT 引入复杂手势或多层 popover 导航。

#### Scenario: Tap to open gloss on touch

- **WHEN** 用户在 touch 设备上 tap 一个词
- **THEN** tooltip MUST 打开并可用 Listen；再次 tap 外部 MUST 关闭
