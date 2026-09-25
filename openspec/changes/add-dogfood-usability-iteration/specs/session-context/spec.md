## MODIFIED Requirements

### Requirement: session context SHALL support correction and refinement within a browser session

客户端 SHALL 在内存中维护最近完成的 SayIt 交互摘要，并在下一次 `/api/retrieve` 请求中可选携带。该 context MUST NOT 写入 localStorage、服务端数据库或 Saved/History envelope。context MUST 只包含有限字段：`input`、`mode`、`assistant_summary`，且 MUST 裁剪为最多 3 轮。

#### Scenario: Send bounded context on follow-up

- **WHEN** 用户在前一轮成功结果后提交 refinement（例如 “no, I mean what Peter says”）
- **THEN** 客户端 MUST 在请求中携带最近最多 3 轮 context，且当前 input 仍是主要请求

#### Scenario: Refresh clears context

- **WHEN** 用户刷新或关闭页面后再次打开 SayIt
- **THEN** session context MUST 为空，除非用户从 History 恢复或产生新的交互

#### Scenario: Restore from History seeds a single-turn context

- **WHEN** 用户从 Local History 恢复一条 past interaction
- **THEN** 客户端 MUST 将 session context **替换** 为仅含该条 interaction 的一条摘要（input、mode、assistant_summary），MUST NOT 恢复该历史时刻的多轮 invisible context

#### Scenario: Saved load does not auto-seed context

- **WHEN** 用户从 Saved 加载一条表达
- **THEN** 客户端 MUST NOT 因该操作自动写入 session context（保持 Saved 与 History 行为区分，除非产品后续另行统一）
