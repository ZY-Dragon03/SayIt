# Proposal

> **产品负责人评审草案，尚未冻结。** 以下方案和验收标准用于评审；在产品负责人确认前，不得将产品契约标为冻结或开始实现。

## Why

SayIt currently helps with English expression and interpretation after the user supplies text, while finding daily reading material remains a manual task. SayIt Reader adds an optional reading workspace that discovers and verifies suitable English articles, then lets the reader use SayIt's existing language tools in context.

## What Changes

- 新增可独立启用的 Reader 模式；建议默认关闭，默认状态待产品负责人确认。启用时展示每日阅读清单和沉浸式文章阅读界面，关闭后恢复用户之前的 SayIt 界面状态。
- 新增阅读偏好：主题、每日篇数、阅读难度、总阅读时长、用户时区和每日收集时间，并提供 Manual Run now。
- 新增动态文章发现、来源核验、去重、全文可读性核验、来源归属、替换及失败状态。静态 RSS 清单可以作为候选来源之一，但不能成为唯一发现方式。
- 收集仅在 SayIt 打开期间执行；若用户时区的当天尚未启动收集，打开 SayIt 时立即补跑；SayIt 关闭期间不得在后台启动收集。打开时补跑与偏好中的计划时间如何共同生效，属于待确认的产品决策。
- 新增本地每日文章归档、阅读进度和历史记录。无法访问或无法核验全文的候选文章不得计作成功交付的全文文章。
- 允许在文章中选择单词、短语或句子并调用现有 SayIt 能力；保留文章阅读位置和原有 SayIt 状态，不复制检索、解释、IPA、语音、保存或复制引擎。

## Capabilities

### New Capabilities

- `reader-plugin-mode`: Reader 的可选启用、模式切换、界面隔离和关闭后的 SayIt 状态恢复。
- `reader-collection`: 阅读偏好、动态发现与整理、用户时区下的打开时补跑和定时/手动运行、来源归属及失败处理。
- `reader-reading-history`: 每日阅读清单、文章阅读、内联 SayIt、阅读位置恢复、本地归档、阅读进度和历史。

### Modified Capabilities

无。当前 `openspec/specs/` 中没有已定义的 capability；本变更新增以上三项。

## Impact

- **现有界面与 SayIt 引擎：** `src/App.tsx`、共享检索结果 contract、IPA/语音/复制/保存/历史模块需要提供可复用的 Reader 调用入口，同时避免覆盖主输入、当前结果和会话上下文。
- **本地数据：** Reader 的偏好、每日集合、文章来源、阅读进度及历史需要独立的数据模型；现有 `sayit.history.v1` 记录成功的 SayIt 交互，`sayit.saved.v1` 保存检索结果，两者都不能单独代表文章归档。
- **联网收集：** 当前仓库只展示了 Vite 开发服务器中的 `/api/retrieve` 代理。Reader 需要另行确定发现服务、全文获取和凭据边界；提供商、生产运行位置、覆盖率和成本尚未确认。
- **浏览器交互：** 新增文章 DOM、文本选择和阅读位置管理；目标浏览器、输入方式与文章全文存储策略需由产品负责人确认。
