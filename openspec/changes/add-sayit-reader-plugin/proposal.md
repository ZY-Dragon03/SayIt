# Proposal

> **产品负责人评审草案，尚未冻结。** 以下方案和验收标准用于评审；在产品负责人确认前，不得将产品契约标为冻结或开始实现。

## Why

SayIt currently helps with English expression and interpretation after the user supplies text, while finding daily reading material remains a manual task. SayIt Reader adds an optional reading workspace that discovers and verifies suitable English articles, then lets the reader use SayIt's existing language tools in context.

## What Changes

- 新增可独立启用的 Reader 模式；建议默认关闭，默认状态待产品负责人确认。启用时展示每日阅读清单和沉浸式文章阅读界面，关闭后恢复用户之前的 SayIt 界面状态。
- 新增阅读偏好：主题、每日篇数、阅读难度、总阅读时长、用户时区和每日收集时间，并提供 Manual Run now。
- Editorial Agent 以保存的偏好为发现输入，动态搜索、核验、去重并整理候选文章；不得把预先固定的 URL 列表或静态 RSS 清单作为完整候选输入。RSS 可以补充发现。
- 按用户时区的计划时间启动定时收集，与 Reader 界面当前是否显示无关。若计划时系统/服务不可用，下次启动时补跑。分别记录计划状态、每次运行尝试和实际 Daily Issue；建议每个计划 occurrence 最多自动尝试三次，Manual Run now 使用独立运行记录且不改变计划时间或自动重试额度。重试次数、间隔及手动结果与当日 Issue 的关系待产品负责人确认。
- 区分完整 Daily Issue、部分 Issue 和未交付；完整 Issue 必须同时满足已保存的主题、目标篇数、难度和总阅读时间约束。供给不足时可显式交付部分 Issue，并列明未满足项，不得静默放宽偏好。
- 核验原始出版来源与实际可访问文章版本。无法访问、只含摘要或收集时已消失的候选不得计为 Reader 全文；可显示明确标识的外链候选、继续搜索或用另一篇通过核验的文章补充。保留原始出版来源和实际阅读版本的分别归属。
- Reader 全文文章必须在应用内实际显示可阅读正文。对允许本地缓存的内容保存阅读位置并支持离线续读；外链候选不得冒充应用内全文。
- 文章中的单词选择优先使用现有本地词典、IPA 和 Listen；短语或句子选择调用现有 SayIt interpretation，并只携带理解所需的文章上下文。两种入口均不得覆盖主 SayIt 工作区或会话上下文。
- 保留本地每日文章归档、阅读进度及与 SayIt 原有查询历史的区分；不复制检索、解释、IPA、语音、保存或复制引擎。
- Product Acceptance 草案从原有 26 个扩展为 36 个案例；本次新增的 10 个案例覆盖按偏好交付、动态 Agent 发现、全文可读性/连续性、外链诚实标记和词/短语交互差异。

### F1–F10 产品范围保留

F1 Plugin Mode；F2 Reading Preferences；F3 Autonomous Discovery；F4 Scheduled/Manual Run；F5 Article Curation；F6 Reading Workspace；F7 Inline SayIt；F8 Daily Archive；F9 Failure Handling；F10 Plugin Isolation。以上是原产品范围的细化验收，没有新增或删除候选功能。

## Capabilities

### New Capabilities

- `reader-plugin-mode`: Reader 的可选启用、模式切换、界面隔离和关闭后的 SayIt 状态恢复。
- `reader-collection`: 阅读偏好、Agent 动态发现与整理、用户时区下的计划运行/停机补跑/手动运行、有界重试、Daily Issue 履约状态及来源归属。
- `reader-reading-history`: 每日阅读清单、文章阅读、内联 SayIt、阅读位置恢复、本地归档、阅读进度和历史。

### Modified Capabilities

无。当前 `openspec/specs/` 中没有已定义的 capability；本变更新增以上三项。

## Impact

- **现有界面与 SayIt 引擎：** `src/App.tsx`、共享检索结果 contract、IPA/语音/复制/保存/历史模块需要提供可复用的 Reader 调用入口，同时避免覆盖主输入、当前结果和会话上下文。
- **本地数据：** Reader 的偏好、每日集合、文章来源、阅读进度及历史需要独立的数据模型；现有 `sayit.history.v1` 记录成功的 SayIt 交互，`sayit.saved.v1` 保存检索结果，两者都不能单独代表文章归档。
- **联网收集：** 当前仓库只展示了 Vite 开发服务器中的 `/api/retrieve` 代理，没有已确认的生产调度器或 Editorial Agent 搜索服务。Reader 需另行确定服务运行位置、动态发现提供商、全文获取、凭据与有界重试策略；提供商、覆盖率和成本尚未确认。
- **本地内容：** Reader 仅可离线保存有权缓存的全文内容，具体允许范围、保留期和清理方式待确认。
- **浏览器交互：** 新增文章 DOM、文本选择和阅读位置管理；目标浏览器、输入方式、词典未命中回退方式与文章正文持久化策略需由产品负责人确认。
