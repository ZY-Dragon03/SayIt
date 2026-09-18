## Why

真实 Dogfood 使用暴露出一个产品级缺口：SayIt 目前只支持“我知道想表达什么，但不知道自然英语怎么说”的单向检索。当用户输入已知表达并询问其语境、习语、俚语、catchphrase 或文化引用含义时，系统会把请求误当成字面检索；随后模型产生的语义类别和字段又不符合单一 retrieval schema，最终退化为不可恢复的通用错误。连续的纠正和澄清也无法引用上一轮结果，因为每次模型请求都是无上下文的。

## What Changes

- 在同一个 `/api/retrieve` 流程中自动判断请求属于 `retrieve` 还是 `interpret`，不增加用户可见的模式选择器。
- 保留现有 retrieve 结果层级，并增加不要求 `natural_sentence` 的 interpretation 结果，用于表达、当前语境含义、用法/引用背景和可选例子。
- 允许 interpretation 覆盖 catchphrase、slang、idiom、proper name 和 cultural reference 等语义类别，避免把合法语义类别误判为非法 retrieval 枚举。
- 在客户端维护最多 3 轮短暂 session context；只在下一次请求中发送，不写入服务器、数据库或 localStorage，刷新或关闭页面即可清除。
- 让当前输入始终是模型主要任务，session context 只用于 correction、clarification、指代和 refinement。
- 保留严格 Zod 校验和一次有界 repair；模型输出为空、JSON 损坏或 schema 无效时，返回可重试错误并保留输入。
- 在本地 Dogfood 开发模式记录安全诊断：失败阶段、失败类别、Zod issue path 和错误 code；不得记录 key、完整输入或完整模型输出。
- 在 DeepSeek Chat Completions 请求中显式设置 `thinking: { type: "disabled" }`，保留 `deepseek-flash`、JSON Output、结构化 prompt 和 repair fallback。
- 不增加聊天 UI、搜索、RAG、数据库、公开部署保护或 Production Hardening。

## Capabilities

### New Capabilities

- `expression-interpretation`: 自动识别已知表达的语境解释请求，并返回受约束的含义、用法/引用背景和可选例子。
- `session-context`: 在单个浏览器会话内保留最多 3 轮短暂交互摘要，用于纠正、澄清、指代和 refinement。

### Modified Capabilities

- `expression-retrieval`: 扩展现有结果契约和错误恢复边界，使 retrieve 与 interpret 能共用同一个输入流程，同时保持原有 retrieve UX。

## Impact

- 共享契约、请求校验、provider abstraction、DeepSeek adapter、Vite API proxy 和 React result renderer 会受影响。
- API 请求仍然是同源 `POST /api/retrieve`；输入格式保持兼容，仅增加受限的可选 context。
- DeepSeek key 仍只存在服务端；session context 由浏览器按请求发送，服务端不持久化。
- localStorage 保存功能继续只保存用户主动保存的 retrieve 表达；session context 不进入本地保存。
- 需要新增 interpretation、context、诊断和 thinking-disabled 的 mock 测试，以及自动路由和纠正流程的 Dogfood fixture。
