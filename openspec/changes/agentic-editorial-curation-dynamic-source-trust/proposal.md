# Proposal

## Why

SayIt Reader V1 已完成验收并通过 PR #1 合入 main。本次只补足两项限制：未知出版域名即使通过正文与来源核验仍被静态名单挡在 FULL_TEXT 之外；现有策展主要依赖确定性查询、关键词与排序，缺少真实语义编辑判断。

## What Changes

- 取消出版者名单对 FULL_TEXT 资格的决定权。未知来源按与已知来源相同的客观访问、来源、完整性、英文正文核验规则处理；出版者名称表仅可用于展示规范化。
- 宽泛互联网搜索成为正式发现路径。固定域名可作为补充提示，不能限制候选宇宙、先耗尽候选预算或决定入选优先级。
- 在安全提取、核验和文章去重之后、Daily Issue 最终选择之前，增加真实模型驱动的 Editorial Agent，基于已保存偏好与有界文章证据判断主题适配、阅读价值、分析深度、新颖性、重复程度及独立观点贡献。
- 版本化并严格校验 Agent 输入/输出边界。Agent 只对已核验候选 ID 给出语义判断，不能更改 URL、来源事实、访问状态或 FULL_TEXT 资格，也不能绕过确定性安全门。
- 以可观察的出版者身份、canonical/source 一致性、独立文章结构与完整正文证据说明来源完整性；不引入政治立场或意识形态评分。
- 每篇新交付文章保留简短选入理由与贡献类型；详情或 trace 可查，默认阅读界面保持 Quiet Fluent Utility。
- 优先复用现有 SayIt 模型配置。语义能力不可用或响应无效时，尝试诚实失败、保留旧交付并遵循原有有界重试；V1.1 默认不启用确定性策展降级模式。

## Required Features

| ID | 必需产品行为 | 验收 |
|---|---|---|
| V11-F1 | 域名名单不再授予或拒绝全文资格；客观来源完整性可追溯 | PAT-V11-01、02、07 |
| V11-F2 | 无完整 URL 输入的宽泛搜索可触达未预列出版者 | PAT-V11-06 |
| V11-F3 | 真实 Agent 使用文章语义证据决定阅读价值和独立观点 | PAT-V11-03、04 |
| V11-F4 | 版本化结构契约校验并限制 Agent 权限 | PAT-V11-05、07 |
| V11-F5 | 新文章保留紧凑语义理由；能力缺失诚实失败 | PAT-V11-08、09 |
| V11-F6 | 最终交付继续满足全部 V1 偏好与履约约束 | PAT-V11-10 及受影响 V1 回归 |

## Capabilities

### New Capabilities

- `reader-dynamic-source-trust`：与域名名单无关的文章来源完整性核验，以及不受静态种子限制的发现。
- `reader-semantic-curation`：基于有界已核验证据的真实语义编辑判断、受约束结构契约、理由与能力失败语义。

### Modified Capabilities

无 canonical 主 specs 可修改（`openspec list --specs --json` 返回空列表）。上述增量补充已验收 `add-sayit-reader-plugin` 的 `reader-collection` 行为，不修改其原始文件、49 项 PAT 含义或历史验收证据。

## Impact

影响 Reader 的候选发现、文章核验、编辑判断、最终约束选择、运行 trace 以及新文章理由持久化。复用现有模型/配置基础设施；无需新付费搜索或模型服务。调度、Daily Issue identity、Manual/Regenerate、归档进度、Inline SayIt 和主工作区隔离仍遵守 V1。

## Scope and Acceptance

本增量定义 10 项新 PAT（PAT-V11-01–10），在一个最终集成候选上验收；另复核 `acceptance-plan.md` 列出的受影响 V1 观察面，运行正常工程套件。旧 V1 的 49 PASS 仍属于其历史候选，本次证据另存，不回填旧报告。真实模型策展和真实宽泛网络发现均为必需证据；mock 不能替代这两项。非目标包括通用推荐引擎、插件框架重构、UI 扩展、重新策展旧归档或新增付费依赖。
