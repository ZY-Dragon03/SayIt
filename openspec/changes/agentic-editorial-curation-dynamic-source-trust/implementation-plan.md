# Implementation Plan

## Identity and Ownership

- 产品 revision：`sayit-reader-v1.1-product-contract-r1`；冻结 commit：`df8b3f53ff1d019034e1c59f82ca8af008649757`。
- 计划基线：`6ddce6fcca4d22651140fde749e78d9eeb4d9374`。
- 本文是工程执行记录，不在冻结语义集合内；不能修改 10 项新 PAT 或 V1 含义。
- runtime_adapter：CODEX_RUNTIME；PM 父线程：`/root/piw_pm_v11`。
- 拓扑：ONE_WORKER。单一候选/模型/持久化路径相互紧密依赖，拆开会在 schema 和 collector 边界冲突。一个 Implementer 保留 PM/实施职责隔离，集成主机可同时准备接受环境。
- delegation_case：parallel_value=POSSIBLE；lead_opportunity_cost=MATERIAL；capability_or_isolation_value=MATERIAL（PM 禁止实现）；estimated_overhead=LOW；benefit_exceeds_cost=true。
- 工作指纹：`sayit-v11-implement-editorial-r1-6ddce6f`；恢复身份：复用本次 PM 创建的 `implement_v11_editorial` 原生线程，不另建执行根。

## Source-Proven Seams

本节依据唯一 Explore 子线程 `explore_v11_feasibility` 的只读报告；它未修改文件、运行测试或发送实时请求。

- `server/provider.ts:294–398` 已有 chat completion JSON mode、model/base URL/key、HTTP 错误、12 秒 abort；`:147–206` 已有 JSON/Zod 校验，`:255–272` 有一次结构修复，`:347` 当前输出限额为 700 tokens。`:81`/`:402` 对外只有 SayIt retrieve，不应把编辑输入塞入 SayItResult。
- `vite.config.ts:27–39` 加载现有模型配置；`server/reader/vite-plugin.ts:6–18` 和 `service.ts:82–90` 已有 serviceOptions/collector 注入边界。Reader 当前未接收模型配置。
- `editorial.ts:942–960` 是静态 FULL_TEXT 域名门；`:485` 解析 canonical 但未用于核验，`:499–509`/`:855–858` 已核对 publisher 冲突，`:748–762` 有独立文章结构证据。
- `editorial.ts:1014–1030` 的关键词前置拒绝应变成语义输入线索；`:1125–1142` 的内容去重和 `:240–264` 的估值保留；`:1149–1185`/`:1331–1340` 最终选择只接收批准候选。
- 宽泛查询与固定提示目前交错（`:304–327`）；前 36 URL 耗尽候选处理预算（`:1263`）。改变预算/顺序以保留宽泛候选机会，不能添加静态域名替代。
- `src/shared/reader-contract.ts:80–99` 是 strict article summary；`store.ts:40–55`、`service.ts:258–279` 管理 trace，新增字段须有界、兼容历史。
- `safe-fetch.ts:204–226`/`:443–494` 是全部 DNS 结果校验、固定 IP 和逐跳重定向边界；本变更不需修改该模块。

## Engineering Approach

1. 从现有 provider 中复用小型有界 JSON completion 传输入口，保留 SayIt retrieve 的 API、prompt、默认 timeout/token budget 和结果契约。新的 `server/reader/semantic.ts` 独立持有编辑 schema、prompt、内容摘录、候选 ID 校验，不获得 fetch 或存储权限。现有配置通过 Vite/Reader options 注入。
2. `extractPage` 增加客观 provenance 结果：可归属身份、canonical/source 可解释关系、独立文章结构、title/metadata/body 一致性证据。缺失 publisher 不能只靠硬编码名字推断已核验；没有跨来源 canonical 的可解释证据则拒绝，绝不由模型解析或抓取它。已知和未知来源同规则。
3. 保留 HTTP/HTML、语言、publisher conflict、Readability/listing、段落覆盖、访问限制、200 词/3 段、英文与结构正文完整性等既有门。移除 FULL_TEXT 名单门后将客观通过/失败信号写入 trace。
4. 正式宽泛查询优先有处理机会，站点提示只能补充；或者使用最小的 broad-only 查询方案。记录来源查询类型和新域名决策。关键词可作为 topic evidence，不再独自拒绝内容；主题与价值由语义决定。
5. 经核验/内容去重后，将候选和已有 Issue 的有界文章摘要送入语义阶段。仅批准 ID 进入原确定性篇数/难度/时长选择，按语义价值/贡献优先级选择可行组合，不能把被否决文章补位。传入旧文章语境以降低同日补齐的重叠。
6. 文章 summary 可选增加紧凑 editorial decision/rationale 和 provenance 记录；历史无字段正常读取。trace 或现有文章 API 能观察理由、贡献和版本，先不新增 UI。失败分支保存语义失败类别与 trace，再复用已有 retry/历史保留机制。

## Bounded Semantic Contract

工程初始限额：每次最多 12 篇新候选；每篇正文证据最多 2400 字符并从开头、中部、末尾抽取，title/publisher 等单独限制；已有文章最多 12 条短摘要；整个序列化输入不超过 40000 字符。被输入预算排除的候选在 trace 中明确记为未送审，不能假装模型拒绝。相关性输入采用已保存主题与内容证据。

响应版本使用显式版本字符串；每个输入 ID 恰有一个决定。决定包含批准/否决、配置主题内的 topic 判断、有限的相关性/价值/分析/新颖性/重叠评价、贡献类型与紧凑理由。所有枚举、分值、长度、候选集合均严格验证；未知/重复/缺失 ID、未知版本和非法值使本次响应无效。URL、publisher、access、FULL_TEXT、估值、COMPLETE 不属于模型写权限。

初始编辑调用上限为单请求 30 秒、最多 4096 输出 tokens；如复用一次结构修复，则一次 collection 最多两次编辑 provider 请求，repair 不扩充候选。无静默 heuristic fallback。最终实际 schema 字段与限额由 Implementer 在返回记录中说明；若工程发现限额不适合，可调整工程值并记录依据，冻结安全/观察契约不变。

## Write Boundaries

单一 Implementer 负责以下路径及同名直接测试：

- `server/provider.ts`、`server/provider.test.ts`。
- `server/reader/semantic.ts`、`server/reader/semantic.test.ts`（新增）。
- `server/reader/editorial.ts`、`server/reader/editorial.test.ts`。
- `server/reader/service.ts`、`server/reader/service.test.ts`。
- `server/reader/store.ts`、`server/reader/store.test.ts`。
- `server/reader/vite-plugin.ts`、`server/reader/api.ts`、`server/reader/api.test.ts`（仅确有需要的注入/trace/API 兼容变更）。
- `src/shared/reader-contract.ts`、`src/shared/reader-contract.test.ts`。
- `vite.config.ts`。

禁止更改 frozen contract 文件、旧 V1 文档/证据、`safe-fetch.ts`、用户配置/密钥、package manifests/lockfile、普通 SayIt UI 或其他仓库。不得 reset/stash/clean；共享 worktree 中不得覆盖他人改动。仅在真正失败要求越界修复时先向 PM 报告精确原因。

PM 只维护新 V1.1 的非冻结工程/状态记录；执行主机 Integrator 固定提交/候选并整合；AE 后续只拥有新验收脚本/证据和报告，不修产品实现。

## Telemetry and Acceptance Handoff

- 每次 attempt：trigger、偏好、真实查询类型/词、候选来源、处理预算排除、客观核验信号与失败、复制/近重复关系。
- 每次语义调用：运行模式、契约版本、provider/model、请求 ID/时间/耗时/状态、输入 candidate IDs 与有界表示散列、验证后的逐候选决定；错误响应需保留类别和安全诊断。不得保存 key；公开证据不复制整篇受限正文。
- 每次选择：客观合格集合、语义批准集合、最终 ID、既有文章上下文引用、硬约束实际值与未满足项。模型断言不得成为完成依据。
- 每篇新交付文章：来源、正文核验/估值、决定版本/关联、简短兴趣/阅读位置理由、贡献类型。重启后仍可查；V1 历史无新增字段仍正常。
- 工程验证：provider 原调用/repair/context 隔离；unknown source 正负、canonical、正文完整性；语义结构/越权/注入/失败；短缺和完整目标；持久化/旧数据；现有安全测试；正常工程套件与构建。
- 实时证据留给最终候选：未知真实来源合格与入选通路、真实语义三候选对照、无 URL 清单的真实 broad collection、一次下游 Reader 正文/外链观察、重启理由/历史和 Regenerate 进度。AE 可以批量复用，不能以本静态计划标 PAT PASS。
