## Purpose

该能力为单个浏览器会话提供极小、短暂的交互上下文，使用户可以自然地纠正、澄清或引用上一轮 SayIt 结果，同时避免把 SayIt 变成持久化聊天系统。

## ADDED Requirements

### Requirement: 系统 SHALL 维护受限的 ephemeral session context

客户端 SHALL 在当前页面会话内保留最近最多 3 个已完成的用户输入与 SayIt 结果摘要。该 context MUST 只存在于客户端内存和当前请求体中，不得写入服务器持久化层、数据库或 localStorage；刷新或关闭页面可以清除它。

#### Scenario: 连续请求携带最近交互

- **WHEN** 用户已经完成至少一轮检索或解释并提交下一次输入
- **THEN** 请求 MAY 携带最多 3 个按时间顺序排列的历史交互摘要，当前输入 MUST 单独作为主要请求

#### Scenario: 超过上下文上限

- **WHEN** 当前会话已经完成超过 3 轮交互
- **THEN** 请求 MUST 只携带最近 3 轮，较早交互 MUST 被丢弃

#### Scenario: 刷新后重新开始

- **WHEN** 用户刷新页面或重新打开 SayIt
- **THEN** session context MAY 为空，且系统 MUST 不从 localStorage 自动恢复这段上下文

### Requirement: session context SHALL 只服务于局部修正和引用

模型 MUST 将当前输入视为主要请求，只能使用历史摘要帮助理解 correction、clarification、`that`、`the other meaning`、`not this one`、`I mean...` 等局部引用和 refinement。系统 MUST NOT 将历史摘要渲染为聊天记录或生成开放式多轮对话。

#### Scenario: 修正上一轮错误解释

- **WHEN** 上一轮输入为 `road house`，结果被误解，下一轮输入为 `no, I mean what Peter says in the cartoon`
- **THEN** 模型 MUST 能使用上一轮摘要定位被纠正的表达，并以当前输入的修正意图为准

#### Scenario: 新请求覆盖旧上下文

- **WHEN** 用户输入一个与历史无关的完整新表达
- **THEN** 系统 MUST 优先处理当前输入，不得强行把结果绑定到旧上下文

### Requirement: session context SHALL 受到请求边界约束

每个 context item MUST 包含不超过输入上限的用户输入、有限 mode 和长度受限的英文结果摘要。服务端 MUST 对 context 数量、字段长度和结构执行运行时校验；非法 context MUST 被拒绝或按稳定应用错误返回。

#### Scenario: context 字段超出限制

- **WHEN** 请求携带超过 3 项、过长输入、过长摘要或未知字段
- **THEN** 服务端 MUST 在调用模型前拒绝该请求，并返回稳定的输入错误，不得把未校验内容发送给 provider

#### Scenario: context 不进入持久化

- **WHEN** 一次请求完成成功、澄清、无匹配或失败
- **THEN** 服务端 MUST 不保存该 context 或完整请求历史，下一次请求只能使用客户端再次携带的摘要
