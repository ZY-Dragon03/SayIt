## Purpose

该能力让用户在已经知道或看到某个英文表达时，直接询问它在当前语境中的含义、用法、习语、俚语或文化引用，而不需要切换模式或进入通用聊天。

## ADDED Requirements

### Requirement: 系统 SHALL 自动识别表达解释请求

系统 SHALL 在同一个 `/api/retrieve` 流程中自动判断当前输入属于 `retrieve` 或 `interpret`。用户 MUST NOT 被要求通过控件选择模式；当前输入和最近的短暂 session context SHALL 一起作为判断依据。

#### Scenario: 已知表达询问语境含义

- **WHEN** 用户输入 `road house, what isnt the meaning of the house beside the road. i wanna know its other meaning. such as what peter say in the catoon`
- **THEN** 系统 MUST 选择 `mode=interpret`，而不是把请求当作字面表达检索或通用聊天

#### Scenario: 解释请求包含上一轮纠正

- **WHEN** 用户输入 `no, I mean what Peter says in the cartoon` 且最近上下文包含对 `road house` 的上一轮结果
- **THEN** 系统 MUST 将当前输入解释为对上一轮表达的 refinement，并优先回答 Peter Griffin 语境中的含义

#### Scenario: 只有表达但语境不足

- **WHEN** 用户只输入一个可能具有字面义和文化义的表达，且没有足够上下文判断
- **THEN** 系统 MUST 返回 `mode=interpret` 的 `needs_clarification` 或有限可靠解释，不得武断地声称字面义是唯一含义

### Requirement: interpretation 结果 SHALL 使用严格的最小结构化契约

成功的 interpretation 结果 MUST 包含 `schema_version`、`mode=interpret`、`status=success`、`normalized_input`、`inferred_intent` 和 `interpretation`。`interpretation` MUST 包含 `expression`、`kind`、`meaning_in_context`、`usage_or_reference` 和可空的 `example`。系统 MUST NOT 要求或伪造 `natural_sentence`。

#### Scenario: 返回文化引用解释

- **WHEN** 模型可靠识别 `Road House` 是 catchphrase 或文化引用
- **THEN** 结果 MUST 返回表达、当前语境含义、用法/引用背景，并可将 example 设为 `null`

#### Scenario: 覆盖受控语义类别

- **WHEN** 被解释表达属于 literal expression、idiom、slang、catchphrase、cultural reference、proper name 或其他受支持类别
- **THEN** `interpretation.kind` MUST 使用对应封闭枚举值，未知但合法的类别 MUST 使用 `other`，不得引入任意未校验的类别字符串

#### Scenario: 解释结果需要澄清

- **WHEN** 模型无法在多个语境含义之间可靠选择
- **THEN** 系统 MUST 返回 `status=needs_clarification`、一个简短英文 `clarifying_question`，且不得伪造完整 interpretation

### Requirement: interpretation UI SHALL 保持单页轻量结果体验

客户端 SHALL 在现有结果区域内显示 Expression、Meaning in this context、Usage / reference，以及仅在非空时显示 Example。用户 MUST 能复制这些有用字段；界面 MUST NOT 增加模式选择器、聊天记录或百科式长文。

#### Scenario: 显示解释结果

- **WHEN** 客户端收到合法的 `mode=interpret` 成功结果
- **THEN** 结果面板 MUST 使用解释字段渲染，并隐藏 retrieve 专属的 Best match、Natural version 强制布局

#### Scenario: 解释结果失败后重试

- **WHEN** provider 返回可重试的 invalid provider response
- **THEN** 客户端 MUST 保留当前输入、显示有用的重试提示并提供 Retry，不得渲染半成品模型输出
