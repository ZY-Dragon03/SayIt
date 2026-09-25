## Purpose

自动记录近期成功解析的 SayIt 交互，使用户无需手动 Save 即可在时间线上找回输入与完整语义结果；与 Saved 长期收藏分离。

## ADDED Requirements

### Requirement: History SHALL be automatic and separate from Saved

客户端 SHALL 维护独立的 Local History，不得与 Saved 列表共用存储键或混淆入口。History MUST 在用户未执行 Save 时也能记录符合条件的交互；Saved MUST 仍仅由用户显式 Save 触发。

#### Scenario: Success interaction appears in History

- **WHEN** 一次 `/api/retrieve` 返回 HTTP 200 且 `SayItResult` 校验通过，且 `status` 为 `success`
- **THEN** 客户端 MUST 将该次 `input` 与完整 `result` 写入 History（不含 IPA）

#### Scenario: Saved remains explicit

- **WHEN** 用户未点击 Save
- **THEN** Saved 列表 MUST NOT 自动增加条目，即使 History 已记录该次交互

### Requirement: History SHALL persist restorable snapshots locally

每条 History 记录 MUST 包含：`id`、`created_at`、原始 `input`、完整语义 `result`（`SayItResult`）、以及可展示的 `mode`（retrieve/interpret）。IPA、gloss、theme、pronunciation 偏好及 invisible 多轮 context MUST NOT 作为 History 字段持久化。

#### Scenario: Restore retrieve success

- **WHEN** 用户从 History 选择一条 retrieve `success` 记录
- **THEN** UI MUST 恢复该 `input` 与完整 retrieve 渲染所需字段，并由当前本地 IPA 层重新加载 IPA

#### Scenario: Restore interpret success

- **WHEN** 用户从 History 选择一条 interpret `success` 记录
- **THEN** UI MUST 恢复 interpretation 视图所需字段，并由当前本地 IPA 层为 interpretation expression 重新加载 IPA

### Requirement: History UI SHALL use a dedicated left drawer

顶栏 MUST 提供轻量 History 入口。History MUST 以 sidebar drawer 打开，优先从 **左侧** 滑入。打开 History 时 SHOULD 关闭 Saved drawer；两者 MUST NOT 同时占据主界面。

#### Scenario: Open History from top bar

- **WHEN** 用户点击 History 入口
- **THEN** 系统 MUST 显示按时间新近优先的 History 列表，并允许选择一条恢复

### Requirement: History SHALL be bounded and deduplicated

History MUST 保留约 **200** 条记录上限。客户端 MUST 跳过与上一条 **dedupeKey** 相同的连续成功交互，避免重复刷屏。Provider/API 错误及未通过 schema 的响应 MUST NOT 写入 History。

#### Scenario: Skip consecutive duplicate

- **WHEN** 用户连续两次提交相同 input 且 fingerprint 相同并成功
- **THEN** History MUST NOT 增加第二条相同记录

#### Scenario: Do not record provider failure

- **WHEN** `/api/retrieve` 返回错误或客户端无法解析 `SayItResult`
- **THEN** History MUST NOT 新增条目

### Requirement: History restore SHALL re-seed ephemeral context only from the selected item

恢复 History MUST 将当前 ephemeral session context **替换** 为仅含所选交互的一条摘要（input + mode + assistant_summary），以支持后续 “that / not this one” 类 follow-up。恢复 MUST NOT 回放该历史时刻不可见的多轮 context。恢复 MUST NOT 改变当前 theme 或 pronunciation 偏好。

#### Scenario: Follow-up after restore

- **WHEN** 用户从 History 恢复 “Road House” interpret 结果后输入 refinement
- **THEN** 下一次 `/api/retrieve` MUST 携带仅基于该 restored 交互的 session context（至多与其他新 turn 合并现有 3 轮上限规则）

#### Scenario: Preferences stay current

- **WHEN** 用户恢复一条 History 且当前 accent 为 UK
- **THEN** 显示的 IPA 与 Web Speech MUST 使用 UK，而非历史写入时的假设口音
