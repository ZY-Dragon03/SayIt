## Purpose

让 Meaning in this context、Usage / reference、Example 与 Explanation 在视觉上与交互上保持一致，降低 Dogfood 阅读时的区块割裂感；不改变语义 API 契约。

## ADDED Requirements

### Requirement: Explanatory sections SHALL share one result text block pattern

SayIt MUST 使用单一可复用的解释性结果文本块组件渲染以下用户可见英文内容（当字段存在时）：

- interpret：`meaning_in_context`、`usage_or_reference`、`example`
- retrieve：`short_explanation`（Explanation）

各区块 MUST 共享相同的 typography、垂直间距、surface/背景处理、以及 contextual Listen/Copy 行为（含 desktop hover/focus 与 touch 可发现性）。

#### Scenario: Meaning and Example look consistent

- **WHEN** interpret 结果同时包含 Meaning 与 Example
- **THEN** 两者 MUST 使用相同的文本块结构与 action 布局，Example MUST NOT 单独使用弱化或不同的 explanation 样式

#### Scenario: Dark mode parity

- **WHEN** 用户切换到 dark theme
- **THEN** 所有解释性文本块 MUST 保持一致的 contrast 与 border/surface 行为

### Requirement: Refactor MUST NOT change SayItResult contract

本能力 SHALL 仅影响 React 渲染与 CSS。`/api/retrieve` 的 `SayItResult` JSON 字段、Zod schema 与 DeepSeek prompt MUST NOT 因 UI 统一而变更。

#### Scenario: API payload unchanged

- **WHEN** 客户端提交 retrieve 或 interpret 请求
- **THEN** 请求与响应契约 MUST 与重构前一致（除本 change 其他能力显式引入的部分）
