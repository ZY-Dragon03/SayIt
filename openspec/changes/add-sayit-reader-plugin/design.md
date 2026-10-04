# Design

> **产品契约状态：冻结 v1.0。** 冻结依据为 Product Owner 对 A–D 的明确批准和对本变更直接实施的授权。产品验收含义以三份 delta specs 中的 49 个 PAT 为准；后续技术选型不得改变其含义。Git 冻结 commit identity 在本规格提交后通过 annotated tag 记录。

## Context

当前应用由单一 React App 管理 SayIt 的输入、结果、会话上下文和历史；/api/retrieve 由 Vite 开发服务提供。当前没有 Reader、每日集合、调度状态、文章档案、正文缓存或 Editorial Agent。新增能力必须保持原有 SayIt 工作区状态，并把文章级数据与 SayIt 交互历史分开。

本设计将产品决定与工程决定分开。产品规则在本设计及三份 delta specs 中冻结；服务部署、存储引擎、发现提供商、HTTP adapter 和具体依赖由实现阶段通过 Implementation Plan 与 Feasibility Gate 选定。工程方案必须满足冻结 PAT，优先本机/免费能力，不得未经批准承诺新的付费服务。

## Goals

- 保留原 SayIt 界面、主会话、存储和已有能力；Reader 为默认关闭的可选工作区。
- 以真实、动态互联网发现取代人工找文章；按偏好验证、去重、替换并整理全文。
- 以一个本地日期对应一个 Daily Issue 合并 Manual、scheduled 与 catch-up 的交付。
- 把计划 occurrence、run attempt、Daily Issue fulfillment 作为独立可观察状态。
- 让全文、来源归属、估算方法、离线资格、失败和短缺状态对用户诚实可见。
- 对 49 项冻结 PAT 逐项提供候选版本绑定证据；工程单测或 build 不能代替产品验收。

## Non-Goals

- 不把固定 URL 列表或固定 RSS 清单当作完整发现输入。
- 不绕过登录、付费墙、反爬访问限制，不把摘要或不完整副本称为全文。
- 不复制 SayIt 的检索、解释、词典、IPA、语音、保存或复制实现。
- 不在没有明确缓存许可时持久化文章全文。
- 不创建历史日期的 Daily Issue 来补齐长期停机期间遗漏的计划。

## Frozen Product Contract

### 插件与 SayIt 隔离

Reader 默认关闭。开启后显示阅读清单或文章阅读面，隐藏并停用 SayIt 主输入/检索面；Reader 的上下文 SayIt 结果独立显示。关闭或重载后，原有 SayIt 输入、结果、会话上下文、已保存表达和交互历史不被 Reader 覆写。Reader 的文章归档、Issue 版本和阅读进度使用独立模型。

### 单一日期 Issue 与运行生命周期

一个配置时区的本地日只有一个稳定 Daily Issue identity。Manual Run now 与该日 scheduled occurrence 都把合格文章合并到此 Issue；新增只补足尚未满足的偏好，不能添加重复文章或另建平行 Issue。

Issue fulfillment 独立于 attempts：

- COMPLETE：精确篇数、全部主题/难度约束和阅读预算区间均满足。
- PARTIAL：至少有合格全文文章，但一个或多个已配置约束未满足；列出实际值和短缺原因。
- NOT_DELIVERED：没有可交付的合格全文。

Scheduled occurrence 有独立日期、时区、本地计划时间、状态和 retry budget。每个 attempt 记录来源（manual、scheduled、catch-up、regenerate）、开始/结束时间和结果。attempt 启动或结束不会自动把 Issue 标记为 COMPLETE。

若 Manual Run 已使 Issue COMPLETE，计划 occurrence 到期时记录 ALREADY_FULFILLED 并不调用发现服务。若 Issue 为 PARTIAL，scheduled attempt 使用相同 Issue identity 继续补足。普通 Manual Run 不替换已完成 Issue；替换只允许由独立明确的 Regenerate 操作触发。Regenerate 递增同一日期 Issue 的 edition，旧 edition、已交付文章和阅读进度保留在该日期历史中；未改变的文章沿用进度，移出当前 edition 的文章仍可从旧 edition 读取。

每个 scheduled occurrence 最多三个 scheduled attempts（一次初始加两次重试），瞬时网络/服务故障可按 5 分钟、15 分钟重试；永久访问/全文校验失败通过候选替换处理，不重复抓取同一失败候选。Manual Run 和 Regenerate 有独立触发记录，不消耗 scheduled retry budget，也不改变未来日期/时刻。

### 计划日期和停机补跑

发生时刻由 occurrence 创建时保存的 IANA timezone 和该地本地日期/时间决定。计划时间前启动服务只建立/检查待执行 occurrence，不提前运行。服务或主机关闭时不要求它继续执行；下次服务启动：

1. 将当前日期之前未执行的历史 occurrence 标记为 MISSED，不发起历史收集。
2. 若当前日期计划时间尚未到，等待该计划时间。
3. 若当前日期计划时间已过且 Issue 未 COMPLETE，只补跑当前日期 occurrence，并使用该 occurrence 剩余 attempts。
4. 若当前日期 Issue 已 COMPLETE，将当前 occurrence 标为 ALREADY_FULFILLED。

同一时区同一日只允许一个 occurrence。DST 跳过的不存在本地时刻顺延到该日第一个有效时刻；DST 重复时刻只执行一次。改变时区不重算已创建的 occurrence，之后日期使用最新保存时区。

### 文章资格、估算与去重

完整 Issue 的总估计阅读时间必须在配置预算的 70% 至 100% 之间（含边界）；100% 为硬上限。篇数是精确目标，每篇须匹配一个或多个已选主题并符合所选难度。

估值方法固定且可复算：

- 正文词数使用提取后英语正文中的空格分词计数；估计分钟数为正文词数 ÷ 200 words per minute，Issue 时长为合格全文的估计分钟数之和。界面显示词数、阅读速率和估计时长。
- 难度以正文 Flesch–Kincaid Grade Level 估计，公式为 0.39 × (词数/句数) + 11.8 × (音节数/词数) − 15.59。音节数使用项目内、可测试的英语音节计数规则；句数、词数、音节数和分级结果可在文章信息中查看。Easy ≤ 8；Intermediate > 8 且 ≤ 12；Advanced > 12。
- 任一估计仅代表可观察的内容指标，不宣称等于用户个人能力或精确阅读耗时。缺失/太短正文不能给出可信估值，因而不计为全文。

去重顺序为规范化/最终 URL、正文指纹和正文相似度。相同规范 URL、相同正文、转载/联合发布/镜像，或正文 5-word shingles Jaccard 相似度至少 0.85 且没有有意义独立内容的近重复文章只能占一个位置。仅有共同事件、实体、主题或关键词不构成重复；正文差异明显且有独立报道/分析内容的文章可以同时入选。Agent 保存去重依据和判定说明。

### 来源与全文状态

每篇候选分开记录 Original publication、Original URL、Accessible version、Accessible URL、正文核验状态和缓存资格。相同版本时两个来源字段可指向同一出版页；可访问替代版不得冒充原始出版页。替代文章自身归属自己的出版来源。

全文状态仅在当前可访问正文通过正文长度/段落/语言/标题与非摘要/非登录/非付费墙检查后成立。外链/摘要候选不计入完整篇数或阅读时间。已交付全文在打开时可使用可核验本地缓存，或在在线状态重新抓取和核验；源站消失时不能依旧把旧摘要或标题当全文。

仅在来源提供明确允许本地保留的许可或其他明确授权信号时持久化正文，以供重启和离线使用。许可未知时可以在当前在线会话内显示刚验证的正文，但不缓存全文；历史保留来源和外链状态。不得绕过登录/付费墙或访问限制。

## Engineering Decisions to Resolve After Freeze

这些选择由 implementation roles 在不改变产品语义的前提下完成，并记录在实施计划及 feasibility receipt 中：

- Windows 本地服务由哪个现有启动入口管理，以及 dev/preview 的 API 生命周期。
- 动态发现 provider、是否需要备选 provider、实际可用性/配额和免费服务故障策略。
- HTML fetch、readability extraction、非执行式正文清理和 source/robots/permission 检查使用的依赖。
- Reader 偏好、attempt、Daily Issue edition、候选、正文缓存和阅读位置的本地持久化格式。
- scheduler 的可测试 clock、系统重启恢复和并发保护方式。
- 候选页面 SSRF/私网地址防护、请求超时、响应大小、重定向限制和 localhost API 绑定策略。
- 真实网络 Editorial Agent 验收的可复现配置与脱敏 trace 位置；真实 SayIt interpretation 验收使用已配置现有 provider，不引入新付费服务。

## Acceptance Plan

- Freeze baseline：49 个 PAT-RM/PAT-RC/PAT-RH，编号和含义只在产品契约变更并经用户授权时才能变化。
- 自动化层：模型/存储校验、时钟控制的 schedule/retry/catch-up、发现/去重/预算规则、Reader 与主状态隔离。
- 集成层：本地 Windows 收集服务、真实动态搜索与抓取、真实文章选择→现有 SayIt interpretation。
- 手工产品层：浏览器中验证启停、设置持久化、全文阅读、恢复位置、归档和上下文选择。
- 候选报告：每个 PAT 标记 PASS/FAIL/NOT-RUN，记录 candidate SHA、浏览器/服务版本、运行输入和证据引用。任一必须项未 PASS 时不得声明 PRODUCT_ACCEPTED。

## Rollback

通过关闭 Reader 功能入口回退可见界面，不改写 SayIt 历史或 Saved。Reader 独立数据在用户选择明确清理操作后删除；失败或 Regenerate 不自动删除旧 edition、文章或阅读进度。
