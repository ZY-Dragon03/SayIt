## Context

现有 provider 只接收当前输入，并要求模型返回单一 retrieval 结果。`expression_type` 是封闭枚举，`status=success` 还强制要求 `best_match` 与 `natural_sentence`；模型若返回 `catchphrase`、`cultural_reference` 或解释字段，严格 schema 会拒绝结果。当前 `validateContent` 只返回成功/失败并丢弃 Zod issues，repair 失败后客户端只能看到通用的 `invalid_provider_response`。

本变更继续使用同源 `POST /api/retrieve`、DeepSeek server-side adapter、Zod runtime validation 和 localStorage 显式保存。会话上下文由浏览器随请求携带，服务端只在当前请求链路中转发，不保存。

## Goals / Non-Goals

**Goals:**

- 用一个稳定的 `mode` 结果判别 `retrieve` 与 `interpret`，由模型自动选择，用户不选择模式。
- 保持 retrieve 的 Best match、Useful expressions、Natural version 和可选 Explanation UX。
- 为 interpret 提供 Expression、Meaning in this context、Usage / reference 和可选 Example，不要求伪造自然句。
- 让最近最多 3 轮用户输入与 SayIt 摘要支持 correction、clarification、指代和 refinement；当前输入优先。
- 保留一次 bounded repair，并在本地开发模式记录不含敏感正文的解析/schema 诊断。
- 显式关闭 DeepSeek thinking，减少正常 Dogfood 请求的推理开销。

**Non-Goals:**

- 不增加模式切换控件、聊天记录、流式输出或多轮聊天 UI。
- 不把完整模型输出、完整历史、原始查询或 session context 写入数据库、服务器持久化层或 localStorage。
- 不增加 web search、RAG、词典数据库、账户同步或 Production Hardening。
- interpretation 结果在本次小迭代中只支持复制和继续 refinement；不扩展 local expression memory 的保存模型。

## Decisions

### 1. 使用同一 endpoint 的自动语义路由

`POST /api/retrieve` 的请求仍以 `input` 为核心，provider prompt 要求先判断当前请求是：

- `retrieve`：用户知道意图，但缺少自然表达；
- `interpret`：用户已经指出或暗示一个表达，并询问当前含义、用法、引用或文化语境。

模型必须返回 `mode`。输入 `road house` 这种缺少语境的表达可以返回 interpret 的澄清结果，而不是武断地当作字面检索；下一轮 `no, I mean what Peter says in the cartoon` 会利用 session context 产出解释结果。模式只存在于结构化结果，不暴露为 UI 控件。

备选方案是客户端模式选择或增加 `/api/interpret`；前者把推断负担转给用户，后者复制 API 和错误流程，因此不采用。

### 2. 采用兼容的结果 union，而不是放宽任意 JSON

共享契约保留现有 retrieve 字段，并增加 `mode: "retrieve"` 的默认值，以便旧的 v1 retrieve 保存快照仍能读取。新增 `mode: "interpret"` 结果只包含通用状态字段和受约束的 `interpretation` 对象：

```json
{
  "schema_version": "1",
  "mode": "interpret",
  "status": "success",
  "normalized_input": "road house",
  "inferred_intent": "asking about a cultural reference",
  "interpretation": {
    "expression": "Road House",
    "kind": "catchphrase",
    "meaning_in_context": "A catchphrase or cultural reference, not the literal meaning of a house beside a road.",
    "usage_or_reference": "Peter Griffin uses it as a running gag referencing the movie Road House.",
    "example": null
  },
  "clarifying_question": null
}
```

`kind` 使用小型封闭枚举，至少覆盖 `literal_expression`、`idiom`、`slang`、`catchphrase`、`cultural_reference`、`proper_name` 和 `other`。retrieve 的 `expression_type` 不被任意放宽。`interpret` 成功时不要求 `best_match` 或 `natural_sentence`，从契约层避免伪造字段。

备选方案是所有结果共用一组可选字段；这会允许错误的字段组合并削弱渲染边界，因此采用按 mode 区分的严格 union。

### 3. session context 由客户端维护并压缩为摘要

客户端 state 维护最近最多 3 个已完成交互，每项只包含：

- `input`：不超过 500 字符的上一轮用户输入；
- `mode`：上一轮结果模式；
- `assistant_summary`：由结构化结果生成、长度受限的英文摘要。

下一次请求携带这组数组，服务端执行同样的 schema/大小校验，再把它放入明确的 `<session_context>` 数据区。prompt 明确要求当前 `<user_input>` 优先，历史只用于指代和修正，不得把请求变成聊天回答。请求失败不新增交互；刷新页面自然清空。加载或保存 localStorage 项目不自动写入 session context。

备选方案是发送完整历史结果或由服务端保存 session；前者增加 token 和隐私暴露，后者需要状态存储且违背 Dogfood 目标，因此采用客户端短摘要。

### 4. 保留严格校验、一次 repair 和安全诊断

provider 将模型内容分类为：

- `empty_content`：trim 后为空；
- `malformed_json`：无法解析 JSON；
- `schema_invalid`：JSON 可解析但 Zod 校验失败。

每次失败只在本地开发诊断器中记录 `attempt`、分类、issue 数量以及每个 issue 的安全 `path` 和 `code`。不记录 key、完整输入、完整输出或由模型生成的任意 issue message。第一次失败仍进入现有一次 repair；repair 仍失败则返回 `invalid_provider_response`，错误文案明确可重试，客户端保留输入。

诊断通过 provider 的可选本地 logger 注入，Vite development server 开启，生产配置关闭。这样不会把诊断协议暴露给浏览器或 API 响应。

### 5. 正常请求显式关闭 thinking

DeepSeek 请求体继续使用 `model: "deepseek-flash"`、`response_format: { type: "json_object" }`、现有 prompt 和 bounded repair，并新增：

```json
"thinking": { "type": "disabled" }
```

不添加动态 reasoning effort，不根据输入模式切换推理设置。产品策略是 small context > more reasoning。

## Risks / Trade-offs

- [模型错误选择 mode] → 用 retrieve/interpret fixture、Road House correction fixture 和有限澄清状态验证；不让用户承担模式选择。
- [上下文把当前请求带偏] → 限制 3 轮、摘要长度、明确 current input 优先，并对 correction/refinement 做 mock contract test。
- [旧 localStorage 快照缺少 mode] → retrieve mode 使用默认值，解释结果不进入旧的保存模型；保留现有存储 envelope 版本。
- [interpretation schema 过窄] → 使用受控的 `kind` 枚举和 bounded fields；未知类别使用 `other`，不回退到 arbitrary free-form rendering。
- [诊断泄露敏感内容] → 只输出分类、路径和 Zod code；开发日志也禁止 raw input/output/key。
- [关闭 thinking 后质量下降] → Dogfood 用例比较结构化有效率、路由正确率、延迟和修复率；不在本变更引入动态推理策略。

## Migration Plan

1. 先增加共享 result union、request context schema、provider prompt/diagnostic 和 `thinking` 请求字段，并用 mock 验证旧 retrieve fixture 仍然合法。
2. 增加 API context 转发和客户端 ephemeral state；不修改 localStorage key 或保存 envelope。
3. 增加 interpret renderer 和复制动作；retrieve renderer 保持原有层级。
4. 使用 mock 运行 Road House、correction、malformed JSON、empty content、schema-invalid 和 repair-success/failure 验收。
5. 本地配置真实 key 后再进行一次受控真实模型检查；若结果质量不佳，可回滚本变更的 prompt/contract 实现，不影响旧 saved retrieve 快照。
