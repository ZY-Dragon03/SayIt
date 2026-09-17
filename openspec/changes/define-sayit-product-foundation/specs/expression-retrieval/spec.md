## Purpose

该能力把用户不完整、带拼写或语法噪声的英语想法转换成自然、可直接使用的英文表达，并让用户无需先判断自己需要单词、搭配、短语还是完整句子。

## ADDED Requirements

### Requirement: 用户无需选择表达类型即可检索

系统 SHALL 接受破碎英语、不完整句子、模糊描述、概念、拼写错误、语法错误和部分句子，并根据上下文推断用户最可能想表达的意思以及最有用的表达粒度。用户 MUST NOT 被要求先选择 word、phrase、collocation 或其他表达类型。

#### Scenario: 概念描述得到单词和可用短语

- **WHEN** 用户输入 `put many things in some category by same feature`
- **THEN** 结果 MUST 把 `categorize` 作为最佳匹配，并可提供 `categorize items by type` 与 `group them into categories` 等可直接使用的表达或句子

#### Scenario: 部分句子得到词块或短语动词

- **WHEN** 用户输入只包含上下文片段、但没有完整句子的英语
- **THEN** 系统 MUST 根据语义选择最有用的词块、短语、短语动词、习语、搭配、句型或完整句，而不是强制只返回一个单词

#### Scenario: 意图确实有多个合理解释

- **WHEN** 输入在语义上无法支持一个明显优于其他候选的解释
- **THEN** 系统 MUST 返回有限的候选或 `needs_clarification` 状态，并给出一个简短的英文澄清问题；系统 MUST NOT 假装确定或输出无关的长篇解释

### Requirement: 系统 SHALL 区分输入噪声与可学习表达

系统 SHALL 将明显的键盘误触、重复字母、拼写错误和低价值语法噪声与真正的表达或词汇缺口分开处理。明显且不改变意图的噪声 SHALL 被静默归一化；真正值得学习的表达 MUST 出现在 `learnable_items` 中，而明显 typo MUST NOT 被当作学习重点。

#### Scenario: 明显键盘拼写错误被静默归一化

- **WHEN** 用户输入包含 `keybroad` 且上下文明确指向 `keyboard`
- **THEN** `normalized_input` MUST 使用 `keyboard`，`typo_corrections` MUST 记录原词和修正词，默认结果 MUST 把真正有用的表达（例如 `make typos`）作为学习项，而不是把 `keybroad` 作为学习项

#### Scenario: 拼写噪声不能掩盖实际表达缺口

- **WHEN** 用户输入 `nobody could say im hangging out` 且语义更可能想表达“没有人认为我在偷懒”
- **THEN** 系统 MUST 把 `hangging` 视为可能的噪声或不确定线索，优先评估 `slack off / slacking off` 等符合意图的表达，并 MUST NOT 仅因字面相似就确定返回 `hanging out`

#### Scenario: 修正会改变可能意图

- **WHEN** 某个拼写或键盘修正存在多个合理解释并会改变最终含义
- **THEN** 系统 MUST 保留不确定性，通过候选或澄清问题表达，而不是静默覆盖用户的原始意图

### Requirement: 结果 SHALL 使用稳定的结构化契约

成功的检索结果 MUST 可被确定性渲染，并至少包含 `schema_version`、`status`、`normalized_input`、`inferred_intent`、`best_match`、`alternatives`、`natural_sentence`、`short_explanation`、`typo_corrections` 和 `learnable_items` 字段。`status` MUST 为 `success`、`needs_clarification` 或 `no_match` 之一；`expression_type` MUST 从 `word`、`collocation`、`phrase`、`lexical_chunk`、`phrasal_verb`、`idiom`、`sentence_pattern`、`sentence` 中选择。

#### Scenario: 成功结果包含可渲染的最佳匹配

- **WHEN** 系统找到足够可靠的自然表达
- **THEN** `status` MUST 为 `success`，`best_match` MUST 包含表达文本和 `expression_type`，`natural_sentence` MUST 是自然且符合输入意图的英文句子，`alternatives` MUST 最多包含 3 项

#### Scenario: 没有必要解释时保持紧凑

- **WHEN** 一个表达可以直接使用且不需要区分近义项
- **THEN** `short_explanation` MUST 为 `null` 或空值，客户端 MUST 不显示空的解释区域

#### Scenario: 输出语言保持为简单英文

- **WHEN** 结果包含表达、自然句、解释、澄清问题或学习项
- **THEN** 这些用户可见内容 MUST 使用英文；系统 MUST NOT 自动附加中文翻译

### Requirement: 默认结果 SHALL 优先呈现可用性而非教学量

客户端 SHALL 按“Best match -> Useful expressions -> Natural version -> 必要时的 Explanation”顺序呈现结果，并提供复制和保存入口。默认结果 MUST 保持单一紧凑结果面板，不得自动展开词典释义、语法课程、聊天记录或无关背景知识。

#### Scenario: 用户快速获取可直接使用的表达

- **WHEN** 检索成功
- **THEN** 用户 MUST 能在一个结果面板中看到最佳匹配、有限替代项和自然句子，并能在不打开额外页面的情况下复制或保存

#### Scenario: 解释不是每次都出现

- **WHEN** `short_explanation` 为空或没有必要
- **THEN** 界面 MUST 隐藏解释标题和空白占位，不能用教学内容填充结果

### Requirement: 无法可靠检索时 SHALL 保持诚实且可恢复

系统 MUST 在没有可靠匹配、输入为空、输入超出限制或模型无法给出可验证结构时返回可识别的状态或错误，不得编造确定答案。用户 MUST 能保留原输入并重新提交或修改，而不需要刷新页面。

#### Scenario: 空输入不触发模型调用

- **WHEN** 输入为空或仅包含空白字符且用户按下提交
- **THEN** 客户端 MUST 不发送模型请求，并以简短提示要求输入一个英语想法

#### Scenario: 没有可靠匹配

- **WHEN** 模型无法支持任何足够可靠的表达
- **THEN** 结果 MUST 为 `no_match` 或 `needs_clarification`，并给出简短英文下一步提示；系统 MUST 不返回伪造的最佳匹配

#### Scenario: 临时服务失败

- **WHEN** 网络、超时、限流或上游模型服务暂时失败
- **THEN** 客户端 MUST 显示可理解的可恢复错误和重试入口，且 MUST 保留用户输入

### Requirement: 检索输入和输出 SHALL 受到明确边界约束

MVP SHALL 接受不超过 500 个字符的单次英语或英语为主的输入；客户端 MUST 在提交前拒绝空输入和超长输入，并给出剩余限制或修改提示。系统 MUST 将输入视为数据，不得把输入中的指令当作系统提示或工具调用。

#### Scenario: 输入超过长度限制

- **WHEN** 用户输入超过 500 个字符
- **THEN** 客户端 MUST 阻止提交并提示缩短输入，且 MUST 保留可编辑的原文

#### Scenario: 输入包含要求改变系统行为的文本

- **WHEN** 用户输入包含提示注入、要求泄露系统提示或要求调用工具的内容
- **THEN** 系统 MUST 仍只按表达检索任务处理该文本，不得泄露服务端提示、密钥或内部信息
