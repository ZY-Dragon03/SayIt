# Design

> **产品契约状态：冻结 v1.0。** 冻结依据为 Product Owner 对 A–D 的明确批准和对本变更直接实施的授权。产品验收含义以三份 delta specs 中的 49 个 PAT 为准；后续技术选型不得改变其含义。冻结记录：annotated tag sayit-reader-product-contract-v1.0 指向产品契约 commit a432b1b00ff1c5c8a733ca45801109948f4e4f62；tag annotation 也记录此完整 SHA。

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

## Implementation Plan and Feasibility Gate

以下均为冻结后确定的工程实现，不改变任何 PAT 的产品含义。

### 本机架构和生命周期

- **采用：**扩展现有 Vite Node 服务。`Start SayIt.vbs` 已在 `127.0.0.1:5173` 启动 Vite；在同一服务进程增加 `/api/reader/*` middleware，并在 Vite `configureServer` 生命周期加载本地 Reader store 和 scheduler。Scheduler 不依赖 Reader 组件是否挂载；浏览器关闭但 SayIt 服务仍在运行时，它仍可执行。主机关闭时无需运行；服务下次启动时按冻结规则恢复当天 occurrence。
- 此 Windows launcher 以后台 Vite 服务进程代表 SayIt 的运行生命周期；关闭浏览器窗口不停止 detached 服务。Reader 是否显示、SayIt tab 是否活跃都不控制 occurrence；主机或 Vite 服务停止后，下次服务启动才执行冻结的 catch-up。
- 所有 API 只绑定 loopback，不启用远端监听、CORS 或外部用户账户。当前 Windows 目标为 Node 24.16；服务在 Node 提供 `http.setGlobalProxyFromEnv()` 时于请求前调用它，使机器已配置的 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 对现有与 Reader `fetch` 生效，并确认现有 `/api/retrieve` 经代理仍可用。不记录代理 URL、用户名或密码。Node 20 不提供该动态接口；无代理时直接联网仍可运行，需要环境代理时提示网络能力不足，不静默跳过。Node 官方代理接口见 [Node.js HTTP built-in proxy support](https://nodejs.org/api/http.html#built-in-proxy-support)。
- 同一 Vite 服务关闭时停止 scheduler timers；启动时以保存的 IANA timezone 和当前 UTC instant 恢复 occurrence。时钟注入到所有日期转换、重试和调度逻辑；DST 用 `Intl.DateTimeFormat`/`Temporal` 兼容转换的单元接口封装，测试固定时钟，不等待真实日历变化。
- Windows 持久化目录为 `%LOCALAPPDATA%\\SayIt\\Reader\\`；非 Windows 测试及开发环境用 `~/.local/share/sayit/reader/`。使用带 schema version 的 JSON envelope 和临时文件原子替换，读写校验失败时返回可见错误而不覆盖原文件。Reader store 与 `sayit.history.v1`、Saved 和其他浏览器 localStorage key 分离。
- API 按资源分区并由 UI client 调用：`GET/PUT /api/reader/preferences` 使用 `{preferences}`；`GET /api/reader/issues/today` 返回 `{issue,occurrence,attempts}`；`GET /api/reader/issues/archive?limit=N` 返回 `{issues}`；`POST /api/reader/run` 接收 `{trigger: "manual"|"regenerate", confirmRegenerate?: true}`，不接收候选 URL，返回 `{attempt,issue}`；`GET /api/reader/runs/:attemptId` 返回 `{attempt,issue}`；`GET /api/reader/articles/:articleId?edition=N` 返回 `{article,paragraphs}`，其中无可验证/可缓存正文时 `paragraphs` 为 `null`，并保留 full-text/external/summary/unavailable 状态；`PUT /api/reader/progress` 接收 `{issueId,articleId,edition,scrollRatio,scrollTop}`。响应都用 versioned JSON。偏好、occurrence、attempt、issue edition、候选 trace、缓存授权和进度均有独立 schema；manual/regenerate request 不写 schedule fields。HTTP 错误返回 `{error:{code,message,retryable}}`，不返回本机文件路径。

### 在线发现、全文核验和依赖决策

- **Search-first-lite verdict：Compose。**运行时按保存主题生成查询，向 DuckDuckGo 的 query-backed HTML 搜索页发送请求，从结果 DOM 发现候选发布者 URL；代码中不订阅固定 RSS 源或注入完整文章 URL。此搜索页不是有 SLA 的搜索 API，HTML 结构或反机器人策略变化时可能失败；实施记录 provider 错误并用有限查询变体继续，仍无候选时返回可见 PARTIAL/NOT_DELIVERED，不捏造结果。将查询、发现 URL、抓取/排除理由和最终选择写入去敏 trace。RSS 如后续验证可作补充，不能成为全部输入。
- **可行性实测：**在 2026-10-04 的 Windows worktree 上，Node 使用机器已配置的 HTTPS proxy 环境变量后，动态 DuckDuckGo query 返回 HTTP 200 和 8–10 个实时结果；没有把候选 URL 传给查询流程。对其中由结果动态发现的出版页面执行 HTTP fetch 和 Readability：若干公开出版页提取出约 682–4,002 个词的文章正文；另有来源返回 401/403、超时或机器人验证页面，必须拒绝并继续候选。直接 Node `fetch` 不启用代理时，对搜索站点超时；启用 Node 24 环境代理后搜索可用。Bing RSS 本次返回无结果；Google News 动态 RSS 有结果但文章链接停留在 Google 包装页，本实现不把包装页当可阅读全文。
- **全文解析：**使用 `@mozilla/readability` + `jsdom`（Compose；前者 Apache-2.0，后者 MIT；Node 当前为 24.x）。Readability 将页面脚本和资源关闭，不执行网站 JavaScript。只接受公开 HTTPS 页面、成功状态、HTML/XHTML、可解析的可读正文、至少 200 英文词和至少 3 个非空正文段落；存在可信 `NewsArticle.articleBody` 时，提取正文词数不得低于其词数的 70%。同时拒绝列表/分类页面、摘要页、验证码、登录/付费墙、截断/“continue reading”提示及机器人/错误页。用正文、标题、paragraph count、结构化 article metadata 和访问状态综合验证；Readability 分数单独不证明全文完整。最终正文转换为纯文本段落，不将网站 HTML 直接注入 React。Mozilla Readability 使用说明见 [mozilla/readability](https://github.com/mozilla/readability)。
- 抓取 adapter 逐次验证初始 URL 和每次重定向：只允许 HTTPS 公网主机；拒绝 localhost、私网、链路本地、保留地址、非 HTTP(S)、嵌入凭据及受限的最终目标；限制 DNS 解析、响应大小、重定向数量和总超时。候选 hostname 必须先解析并固定到已验证公网 IP；若请求经代理，CONNECT 目标使用该已验证 IP、TLS SNI/HTTP Host 保持原 hostname，每次 redirect 重新解析/固定。不得假设代理侧 DNS 与本机解析相同；若运行时无法执行这个固定目标请求，则对该候选 fail closed，不经未验证代理抓取。用含内网、环回、IPv6 本机、redirect 到内网、DNS 多记录和 NO_PROXY 绕行的测试验证。
- 原始 URL、原出版者、HTTP redirect 后的 accessible URL、网页声明的出版者和授权信号分别保存。来源字段不一致时分别保留原出版者和实际可访问出版者；无法核验原归属时不得标注为原文全文。正文或 canonical host 仍无法归属时拒绝全文交付。未获明确本地留存许可的正文只在当前进程内供 UI 返回，不写入 Reader JSON；历史保留元数据、来源和外链状态。只有可观察的明确缓存许可和当前已验证缓存才允许离线全文阅读。

### Scheduler、运行与履约

- 一日 issue id 由 `localDate + timezone` 创建，edition 和 progress 永不原位清除。occurrence 表独立存储计划时间、状态和当日 retry count；attempt 表保存 trigger、开始/结束时间、可重试性及失败原因；issue 表由已验证全文与偏好约束重新计算 COMPLETE/PARTIAL/NOT_DELIVERED。
- 单进程以持久化 `nextAttemptAt` 和可取消 timer 触发 occurrence；跨服务重启启动检查过期 occurrence。写入时使用同步锁/状态 version 避免同一日期并发重复 run。定时 retry 上限严格为冻结的三次（5、15 分钟建议延迟）；manual/regenerate 另记 attempt，不扣该预算。completed issue 的 scheduled callback 只记录 `ALREADY_FULFILLED`。
- 策展不依靠事件 ID 去重。使用规范化 URL、正文 SHA-256 和冻结文档规定的 5-word shingle Jaccard ≥0.85；相似度高时只在无法证明独立增量内容时拒绝。主题匹配用确定性 topic terms + candidate/article text evidence，FKGL 用固定 200 wpm 和可测试英语音节算法；界面显示估算输入、实际值、偏好短缺和每个 reject reason。

### UI 和现有 SayIt 能力

- `App` 保持挂载且持有原 SayIt `input`、`result`、session context、Saved、History。Reader toggle 仅切换主要 workspace 的可见 view。文章位置、最后打开文章、Reader preference、edition 与允许缓存正文通过 Reader API 独立持久化。
- 单词选择先调用现有 `getDefinitionForSurface`、`getIPA`、`PronunciationService`，不请求解释 API；按本地词条现有支持显示定义、IPA、Listen 和 Copy。SayIt retrieval result 显示当前已有 Save/Copy/IPA/Listen；interpretation result 显示当前该结果已有的 Copy/IPA/Listen，不扩展或伪造主 SayIt 的 Save 数据格式。短语/句子走当前 `/api/retrieve` 和 `createDeepSeekProvider`，不带旧主会话 context；以 `Interpret the selected expression “…” in the context of this article sentence: “…”` 形成一条不超过 API 限长的输入，确保复用现有 mode inference；若原选择已是完整句则仅裁剪少量相邻语境。成功后以该实际输入与 SayIt result 调用 `LocalHistoryRepository.append`，进入现有 SayIt interaction history。打开原 history 时按现有模型恢复该查询，不附带文章上下文。Reader 不修改 App 主 input、`result` 或 `sessionContext`。
- Reader progress 保存当前日期/edition/article、首个可见正文段落索引、该段落内偏移及文章滚动比例。退出/重进 Reader 或重启服务后优先回到相同首个可见段落，比例偏差容许 ±5 个百分点以覆盖 viewport 字体/尺寸变化；比例也作为文章进度展示值。
- 不增加编辑部 LLM 或付费 search API；运行成本仅为用户已经配置的 SayIt interpretation provider。收集本身不要求该 provider key。真实 SayIt interpretation acceptance 使用项目已有 `.env.local` 的 `DEEPSEEK_API_KEY`；缺少该配置时明确阻止该验收，不以 mock 结果冒充。

### 失败、回滚和初始依赖评估

- 搜索超时/被限流为可重试服务错误；候选页永久 401/403/404、仅摘要、登录/付费墙、验证码、正文不足或来源不明为候选失败并继续动态发现。最终无足量来源则发布 PARTIAL/NOT_DELIVERED 并保留 trace 与历史。
- 回滚时通过 Reader 入口隐藏插件；既有 SayIt 路径继续由原 `/api/retrieve` 处理。Reader 数据保持在独立本机目录，不迁移或覆写 SayIt history/Saved。清理 Reader 数据仅可作为显式后续用户操作。
- 新增依赖仅 `@mozilla/readability` 与 `jsdom`；前者承担正文提取，后者提供不执行脚本的 DOM。搜索 provider 用原生 fetch/DOM 解析，不增加付费 SDK 或需密钥的服务。当前 worktree 的 `npm audit` 仍为原有 2 个 moderate advisories，未因本次依赖选择增加。

## Acceptance Plan

- Freeze baseline：49 个 PAT-RM/PAT-RC/PAT-RH，编号和含义只在产品契约变更并经用户授权时才能变化。
- 自动化层：模型/存储校验、时钟控制的 schedule/retry/catch-up、发现/去重/预算规则、Reader 与主状态隔离。
- 集成层：本地 Windows 收集服务、真实动态搜索与抓取、真实文章选择→现有 SayIt interpretation。
- 手工产品层：浏览器中验证启停、设置持久化、全文阅读、恢复位置、归档和上下文选择。
- 候选报告：每个 PAT 标记 PASS/FAIL/NOT-RUN，记录 candidate SHA、浏览器/服务版本、运行输入和证据引用。任一必须项未 PASS 时不得声明 PRODUCT_ACCEPTED。

## Rollback

通过关闭 Reader 功能入口回退可见界面，不改写 SayIt 历史或 Saved。Reader 独立数据在用户选择明确清理操作后删除；失败或 Regenerate 不自动删除旧 edition、文章或阅读进度。
