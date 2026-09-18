## MODIFIED Requirements

### Requirement: 用户无需选择表达类型即可检索

系统 SHALL 接受破碎英语、不完整句子、模糊描述、概念、拼写错误、语法错误、已知表达和带语境的问题，并自动判断当前请求属于 `retrieve` 或 `interpret`。用户 MUST NOT 被要求先选择 word、phrase、collocation、retrieve 或 interpret。

#### Scenario: 概念描述得到单词和可用短语

- **WHEN** 用户输入 `put many things in some category by same feature`
- **THEN** 结果 MUST 选择 `mode=retrieve`，把 `categorize` 作为最佳匹配，并可提供 `categorize items by type` 与 `group them into categories` 等可直接使用的表达或句子

#### Scenario: 部分句子得到词块或短语动词

- **WHEN** 用户输入只包含上下文片段、但没有完整句子的英语
- **THEN** 系统 MUST 根据语义选择最有用的 retrieve 表达粒度，而不是强制只返回一个单词

#### Scenario: 已知表达进入解释流程

- **WHEN** 用户询问一个已知表达在当前语境中的含义、用法、习语、俚语、catchphrase、proper name 或文化引用
- **THEN** 系统 MUST 选择 `mode=interpret`，而不是强行套用 retrieve 的 natural sentence 要求

#### Scenario: 意图确实有多个合理解释

- **WHEN** 输入在语义上无法支持一个明显优于其他候选的解释
- **THEN** 系统 MUST 返回有限的候选或相应 mode 的 `needs_clarification` 状态，并给出一个简短的英文澄清问题；系统 MUST NOT 假装确定或输出无关的长篇解释

### Requirement: 结果 SHALL 使用稳定的结构化契约

系统返回的合法结果 MUST 包含 `schema_version`、`mode` 和 `status`。`mode` MUST 为 `retrieve` 或 `interpret`。`mode=retrieve` MUST 保留 `normalized_input`、`inferred_intent`、`best_match`、`alternatives`、`natural_sentence`、`short_explanation`、`typo_corrections` 和 `learnable_items` 字段及其现有边界；旧的 retrieve 结果在缺少 mode 时 MUST 按 `retrieve` 兼容读取。`mode=interpret` MUST 使用独立的受约束 interpretation payload，不得借用 retrieve 的自然句必填条件。

#### Scenario: 成功 retrieve 结果保持可渲染

- **WHEN** 系统找到足够可靠的自然表达
- **THEN** `mode` MUST 为 `retrieve`，`status` MUST 为 `success`，`best_match` MUST 包含表达文本和 `expression_type`，`natural_sentence` MUST 是自然且符合输入意图的英文句子，`alternatives` MUST 最多包含 3 项

#### Scenario: 成功 interpret 结果不伪造自然句

- **WHEN** 系统可靠解释一个表达的上下文含义
- **THEN** `mode` MUST 为 `interpret`，结果 MUST 包含受约束的表达、含义和用法/引用字段，且 MUST NOT 要求或生成仅为满足 retrieve schema 的 `natural_sentence`

#### Scenario: 没有必要解释时保持紧凑

- **WHEN** 一个 retrieve 表达可以直接使用且不需要区分近义项
- **THEN** `short_explanation` MUST 为 `null` 或空值，客户端 MUST 不显示空的解释区域

#### Scenario: 输出语言保持为简单英文

- **WHEN** 结果包含表达、自然句、解释、澄清问题、含义、引用背景或学习项
- **THEN** 这些用户可见内容 MUST 使用英文；系统 MUST NOT 自动附加中文翻译

### Requirement: 无法可靠检索时 SHALL 保持诚实且可恢复

系统 MUST 在没有可靠匹配、输入为空、输入超出限制或模型无法给出可验证结构时返回可识别的状态或错误，不得编造确定答案。provider MUST 在本地 Dogfood 开发模式为空内容、malformed JSON 和 schema-invalid 输出记录安全诊断；诊断 MUST 仅包含失败类别、Zod issue path/code 等摘要，不得包含 API key、完整原始输入或完整模型输出。用户 MUST 能保留原输入并重新提交或修改，而不需要刷新页面。

#### Scenario: 空输入不触发模型调用

- **WHEN** 输入为空或仅包含空白字符且用户按下提交
- **THEN** 客户端 MUST 不发送模型请求，并以简短提示要求输入一个英语想法

#### Scenario: 没有可靠匹配

- **WHEN** 模型无法支持任何足够可靠的 retrieve 或 interpret 结果
- **THEN** 结果 MUST 为对应 mode 的 `no_match` 或 `needs_clarification`，并给出简短英文下一步提示；系统 MUST 不返回伪造的最佳匹配或解释

#### Scenario: 非法模型输出经过有界恢复仍失败

- **WHEN** 模型返回空内容、malformed JSON 或 schema-invalid JSON，且一次 bounded repair 仍未通过校验
- **THEN** 服务端 MUST 返回可重试的 `invalid_provider_response`，客户端 MUST 显示有用的重试提示、保留用户输入，并不得渲染半成品

#### Scenario: 临时服务失败

- **WHEN** 网络、超时或上游服务暂时失败
- **THEN** 客户端 MUST 显示可理解的可恢复错误和重试入口，且 MUST 保留用户输入

### Requirement: 检索输入和输出 SHALL 受到明确边界约束

MVP SHALL 接受不超过 500 个字符的单次英语或英语为主的输入；客户端 MUST 在提交前拒绝空输入和超长输入，并给出剩余限制或修改提示。系统 MUST 将输入和 session context 视为数据，不得把其中的指令当作系统提示或工具调用。

#### Scenario: 输入超过长度限制

- **WHEN** 用户输入超过 500 个字符
- **THEN** 客户端 MUST 阻止提交并提示缩短输入，且 MUST 保留可编辑的原文

#### Scenario: 输入包含要求改变系统行为的文本

- **WHEN** 用户输入或 session context 包含提示注入、要求泄露系统提示或要求调用工具的内容
- **THEN** 系统 MUST 仍只按 SayIt 表达任务处理该文本，不得泄露服务端提示、密钥或内部信息
