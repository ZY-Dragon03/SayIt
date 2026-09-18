## Purpose

为 SayIt 的可学习英文表达提供独立、离线且可选的 US/UK IPA 转写，让发音元数据可以在不依赖 DeepSeek 的情况下生成、缓存和失败隔离。

## ADDED Requirements

### Requirement: Semantic results remain independent of pronunciation

DeepSeek retrieve/interpret 结果 SHALL 只包含语义结果所需字段，不得要求或依赖 `pronunciation` metadata。语义结果在没有本地 IPA、IPA 不确定或 IPA engine 不可用时 MUST 仍然有效。

#### Scenario: Retrieve result without pronunciation metadata

- **WHEN** DeepSeek 返回 Best match、alternatives 和 natural sentence，但没有 pronunciation 字段
- **THEN** SayIt 接受并渲染 semantic result，不触发 schema error

#### Scenario: Interpretation result without pronunciation metadata

- **WHEN** DeepSeek 返回 interpretation expression、meaning 和 usage/reference，但没有 pronunciation 字段
- **THEN** SayIt 接受并渲染 interpretation result，不要求 DeepSeek 补充 IPA

### Requirement: Local deterministic IPA lookup

系统 SHALL 提供接受英文 `text` 和 `us`/`uk` accent 的本地异步 pronunciation lookup，并返回一个 slash-delimited IPA string 或 `null`。该 lookup MUST 不访问 DeepSeek、不调用其他 AI model、不依赖后端 pronunciation endpoint。

#### Scenario: Resolve a known expression locally

- **WHEN** 用户结果包含 `Road House` 且本地 lookup 使用 `us` 或 `uk`
- **THEN** 系统独立返回对应 accent 的 IPA，且不发送新的 DeepSeek request

#### Scenario: Filter empty or clearly non-language input

- **WHEN** lookup input 为空，或明显是 URL、代码片段、纯符号/数字等非语言输入
- **THEN** lookup 返回 `null`，不运行 engine，semantic result 和其他 UI 操作保持可用

#### Scenario: Allow an unknown-word Dogfood guess

- **WHEN** `phonemizer` 对未知词或专有名词返回非空 G2P guess
- **THEN** Dogfood 可以显示该 guess；系统不计算 numeric confidence、不新增 dictionary/service，明显错误留待后续评估

#### Scenario: Switch accent locally

- **WHEN** 用户从 US 切换到 UK
- **THEN** 系统使用 UK lookup 结果更新 IPA，不重新提交当前 semantic request 到 DeepSeek

### Requirement: Pronunciation cache is accent-aware

系统 SHALL 按规范化 expression text 与 accent 组合缓存成功的 IPA 结果；同一 expression 在同一 accent 下的后续 lookup MUST 可复用本地 cache。US 和 UK cache entries MUST 相互独立。

#### Scenario: Reuse a same-accent lookup

- **WHEN** 同一表达以相同 accent 再次需要 IPA
- **THEN** 系统从本地 cache 返回结果，不重复运行 G2P engine

#### Scenario: Keep accents separate

- **WHEN** 同一表达先请求 US、再请求 UK
- **THEN** 系统分别计算或读取两条 accent-specific cache entry，不把 US IPA 当作 UK IPA

#### Scenario: Cache failure is non-blocking

- **WHEN** cache 读取、写入或解析失败
- **THEN** 系统退回内存 lookup 或直接返回 `null`，不影响 retrieve、interpret、Copy、Save、session context 或播放

### Requirement: IPA display is limited to learnable expressions

SayIt SHALL 只在 primary retrieved expression、可用的 retrieve expression alternatives 和 primary interpreted expression 的现有表达区域显示本地 IPA。IPA MUST NOT 出现在 Meaning in this context、Usage/reference、Explanation、Example sentence 或 UI labels 中；没有 IPA 时 SHALL 隐藏该 metadata，而不是显示错误占位。

#### Scenario: Display primary retrieve IPA

- **WHEN** retrieve 的 Best match 有当前 accent 的本地 IPA
- **THEN** IPA 以小号 muted metadata 显示在 expression 附近，并与 expression type 保持同一层级

#### Scenario: Display primary interpretation IPA

- **WHEN** interpret 的 expression 有当前 accent 的本地 IPA
- **THEN** IPA 以小号 muted metadata 显示在 interpretation expression 附近

#### Scenario: Do not transcribe explanatory content

- **WHEN** 结果包含 Meaning、Usage/reference、Explanation 或 Example
- **THEN** 系统不为这些字段触发或显示 IPA

### Requirement: Existing playback remains independent

Web Speech playback SHALL 继续使用原始英文 expression text、现有 accent voice 和 Normal/Slow speed。IPA lookup 的成功、失败、加载和缓存状态 MUST NOT 改变 Listen/Copy actions 或播放行为。

#### Scenario: Play while IPA is unavailable

- **WHEN** 本地 IPA lookup 返回 `null` 或 engine 初始化失败
- **THEN** 用户仍可使用原始英文文本的 Web Speech playback，且结果不显示 IPA 错误

#### Scenario: Accent controls affect both local layers

- **WHEN** 用户选择新的 accent 并播放表达
- **THEN** Web Speech 使用新 accent voice，同时 IPA lookup 使用新 accent；两者都在客户端完成

### Requirement: Private Dogfood distribution restriction

`phonemizer@1.2.1` SHALL 只用于私有/本地 SayIt Dogfood。公开分发 MUST 保持 blocked，直到完成 eSpeak NG license/distribution review，或替换为 permissively licensed engine。

#### Scenario: Keep public distribution blocked

- **WHEN** 评审 SayIt 的公开发布或可分发构建
- **THEN** 当前 change 不得把 `phonemizer@1.2.1` 视为公开分发批准
