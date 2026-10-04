# Design

> **评审草案，尚未冻结。** 技术方向依赖下方标明的产品负责人决策；本文件不授权开始实现。

## Context

See `proposal.md` for the product intent and the three delta specs for observable behavior.

当前应用由 `src/App.tsx` 管理主要输入、检索结果、会话上下文和历史；检索调用 `/api/retrieve`，该路由目前由 Vite 开发服务器配置提供。当前代码没有 Reader、持久化调度器、Editorial Agent 或 Daily Issue 状态。成功的 SayIt 检索进入 `sayit.history.v1`；已保存表达进入独立的 `sayit.saved.v1`。两者均不含 Reader 文章全文和阅读位置。

文本选择可使用浏览器 DOM Selection/Range API。当前 SayIt 主操作会更新主工作区状态，因此 Reader 上下文查询不能未经隔离就直接复用主界面的状态更新处理器。计划收集必须由与 Reader 可见界面分离的服务执行；若调度服务或主机在计划时间不可用，需要持久化到期状态并在下一次启动时补跑。

本轮保持原 F1–F10 产品范围：三份 delta spec 保留原 26 个有效验收案例，并增加 10 个明确覆盖 P0 反馈的案例，共 36 个草案案例。

## Goals / Non-Goals

**Goals:**

- 给出可选 Reader 与既有 SayIt 主工作区并存的状态边界，避免上下文查询污染原会话。
- 定义动态发现、原文核验、全文提取、去重、整理、来源归属与失败信息之间的技术流水线。
- 定义不依赖 Reader 界面显示的计划生命周期、停机补跑、有限重试、本地文章归档和阅读进度边界。
- 把来源提供商、内容保留策略和日运行语义等产品决策显式提交评审。

**Non-Goals:**

- 本阶段不实现代码、不接入服务、不创建服务凭据，也不声称已有生产级文章发现后端。
- 不在本设计中选定商业搜索供应商、承诺其覆盖率或成本，也不把某个 RSS 清单当作完整发现系统。
- 不在尚未确定内容访问和保留政策前承诺可抓取、存档或离线分发任意出版物的全文。

## Decisions

### Reader 模式与 SayIt 状态隔离

建议在现有应用根状态中增加 Reader 模式，而不是卸载再重新挂载整个 `App`。Reader 入口切换模式视图；主输入、结果、上下文和偏好继续由现有状态持有。文章内 SayIt 调用走同一检索服务和共享结果 contract，但把所选文本作为独立请求参数，并在 Reader 的上下文结果面板中展示，不能直接覆写主工作区输入或结果。

这样既能复用现有检索和结果渲染能力，也能满足 PAT-RM-05 / PAT-RH-04 的状态恢复。备选方案是离开 Reader 时序列化整个主会话再还原；它扩大了状态同步面，容易漏掉新增的临时状态，故不作为首选。

### 发现与文章核验使用服务端适配层

建议由受控收集服务承载 Editorial Agent、动态发现适配层、原文获取和敏感凭据。Agent 的运行输入是保存的阅读偏好和可用发现能力；预置 URL 清单不能作为完整候选输入，RSS 只能补充发现。Acceptance 需要来自真实运行的搜索查询、候选来源、核验/拒绝、去重和整理轨迹，以证明发现由 Agent 执行。

候选流水线建议为：偏好生成动态查询 → 搜索并登记候选来源 → 解析并保留原始出版 URL / canonical 提示 → 获取实际可访问版本 → 提取正文、语言、出版者和时间 → 检查全文而非摘要/登录页 → 按故事和正文相似度去重 → 按主题、难度与阅读时间整理 → 生成完整、部分或未交付的 Daily Issue。每个候选分别记录 Original publication 和 Accessible version；无法访问、只含摘要或抓取前消失时，Agent 继续发现/核验或报告短缺，不能将过期元数据当作全文。替换的独立文章使用自身来源。

`Mozilla Readability` 可协助提取正文，但其文档明确说明可读性判断只是启发式，可能误判；因此提取成功不能单独证明全文完整。备选方案是把搜索结果标题/摘要直接当文章交付；这不符合全文阅读意图。Reader 文章视图必须实际呈现可读正文；仅外链候选单独标记且不计入 Issue 篇数或估计阅读时长。

### 计划、尝试和 Daily Issue 分离

建议由可持久化的收集调度服务维护每个用户时区的每日 occurrence。计划在用户配置的本地时间才到期；Reader 界面是否显示不参与触发判定。若服务/主机当时不可用，持久化 `due/overdue` 状态，并在下一次服务或 SayIt 启动时补跑原 occurrence。正式实现需选定可承载此调度并在启动时恢复状态的服务位置；当前 Vite `/api/retrieve` 不能证明已有该运行环境。

产品状态分三层：计划显示待到期、待补跑、执行/重试中或已结束；每次尝试单独记录触发来源（scheduled、catch-up、manual）、序号、时间与结果；Daily Issue 单独显示完整、部分或未交付。开始尝试不等于 Issue 履约。完整 Issue 仅在全文、主题、目标篇数、难度和总估计时长都符合已保存偏好时成立。有限尝试结束后可以留下明确的部分 Issue，否则显示未交付。

评审建议：一个 scheduled occurrence 最多三次自动尝试（首次加两次重试，间隔建议 5 分钟和 15 分钟）；启动时补跑计入该 occurrence 的尝试额度，额度耗尽时明确结束且不抹去失败记录。Manual Run now 建立独立的手动尝试/结果，不更改下一次计划时间、不重置或消耗 scheduled occurrence 的重试额度，也不冒充 scheduled Daily Issue。该建议会避免手动运行破坏未来计划，但同一天是否接受手动结果和定时 Issue 并存仍需 PO 决定。

### 阅读数据与交互历史分开保存

建议将 Reader 的日期集合、文章元数据、文章正文（若内容政策允许）、来源 URL、预计时长、阅读状态和位置保存在独立的 Reader 数据库；大体量全文优先考虑 IndexedDB，偏好和轻量调度索引可沿用本地存储。为已有数据使用单独版本化命名空间，不写入 `sayit.history.v1` 或 `sayit.saved.v1` 的结构。

Reader 中成功完成的 SayIt 查询仍走现有交互历史仓库，满足用户“像原本 SayIt 一样”的查询历史诉求；文章归档和阅读进度则保存在 Reader 历史。是否还要让查询历史项回链到文章，及文章全文的保留期限/删除入口，需要产品负责人确定。离线展示历史全文依赖正文确实被允许并已存入本地。

备选方案是把文章塞入查询历史，或让查询历史承担阅读进度。这两种方案混合了不同实体和生命周期，不便于按日期恢复文章，也会破坏当前历史格式。

### 文章选择和阅读位置恢复

Reader 通过浏览器当前 Selection 获取非空选择文本，并读取选择范围的矩形来放置轻量上下文操作。单词选中优先走现有本地词典定义并提供已有 IPA/Listen；短语或句子走现有 interpretation，请求仅带所选文本和必要的邻近文章语境。执行前复制选择值，不能因按钮获得焦点而依赖实时选择仍然存在。无选择时不发起调用。上下文结果关闭后保留文章及阅读位置，所有路径都不覆写主 SayIt 输入、结果或会话上下文。

此方案使用普通 DOM 阅读文本，无需把文章变成不可选的 canvas 或图像。`selectionchange` 在 Document 上触发但不会冒泡，选择范围也可能为空；因此需直接检查 selection/range 状态。目标浏览器和触摸/键盘操作覆盖尚待产品负责人确认。词典未命中时是否提供 interpretation 回退也待确认。

### 内容呈现与来源归属

文章视图从 Reader 自己存储的纯文本/受清理后的 HTML 渲染，不执行出版页面脚本、不加载其原始页面作为嵌入式应用。界面显示标题、实际正文、Original publication 和 Accessible version；两者相同则明确显示为相同来源，不同则分别链接。外链/摘要候选使用不同状态，不显示成 Reader 全文，不计入完整 Issue 的数量或时长。只把获准保存的正文缓存用于历史和离线续读。

HTML 清理、外部图片与链接的加载方式，以及获准本地缓存的范围和保留时长需要在内容访问政策确认后定稿。难度 rubric 和阅读时间估算须向用户可见，且始终作为估计值；在方法获批前不能声称精确或静默放宽阈值。

## Risks / Trade-offs

- [缺少生产级发现服务、凭据或稳定来源配额] → 在产品负责人批准来源成本与服务部署边界前，不承诺覆盖率；实现前做供应商/服务可行性选型。
- [动态发现能力短时不可用] → 保存搜索与尝试轨迹；区分发现服务故障和候选文章不可读，并按该计划 occurrence 的有限重试预算处理。
- [网站结构、登录墙、付费墙和地区访问会导致提取不完整] → 将不完整候选标成未核验，允许更换候选，并把失败原因留给用户查看。
- [可读性提取器会误判页面正文] → 组合语言/正文长度/元数据/片段特征检查与人工可观察失败状态；不把单一提取结果等同全文核验。
- [文章全文的本地副本涉及内容访问和保留政策] → PO/产品法务策略确认前，不固定全文缓存范围、保留期或离线可用承诺。
- [服务停机或时区/DST 变化会错过计划时刻] → 持久化用户时区下的计划 occurrence；服务恢复时核对待补跑 occurrence，并保留实际尝试时间。
- [手动运行或失败尝试被误当作 Issue 履约] → 分开持久化计划状态、带触发类型的尝试和完整/部分/未交付 Issue 状态。
- [阅读目标互相冲突] → 完整 Issue 才能满足全部已配置约束；不足时显式部分/未交付并列出短缺。
- [Reader 调用复用全局状态会覆盖已有会话] → 使用独立上下文结果呈现边界，并以 PAT-RM-05、PAT-RH-04 检查往返状态。
- [原有保存能力可能因结果类型而不同] → 当前已知 Save 入口用于检索结果；产品负责人需决定解释型结果是否也要支持 Save。

## Migration Plan

在产品负责人确认契约之前不开始实现。获批后，按新能力逐步增加独立 Reader 存储与功能门控；现有 `sayit.history.v1` 和 `sayit.saved.v1` 数据不需迁移。回滚时关闭 Reader 入口并保留/提供 Reader 本地数据清除策略，不修改现有 SayIt 历史记录。由于尚未选择生产服务端和供应商，部署与回滚细节须在服务方案获批后补全。

## Product Owner Decisions Before Freeze

以下决定会改变验收口径或实现方式，当前均未冻结：

1. Reader 的默认状态是关闭还是首次启动时引导启用。
2. 选择承载定时调度的服务及“下一次启动”的定义；Reader 界面不可见不阻止到时执行，服务/主机停机时在恢复后补跑原 occurrence。
3. 是否采用评审建议的每 occurrence 最多三次自动尝试（首次加两次重试，间隔 5 分钟和 15 分钟）；确定哪些故障可重试，以及重试耗尽时的部分/未交付策略。
4. Manual Run now 是否总是生成独立手动结果，还是可以更新当日计划 Issue；若手动结果已完整，计划时间到达时是否仍再次收集。手动运行不得改动下一计划时间或自动重试预算。
5. “当天”的分界、用户时区变更与夏令时切换采用何种规则；定时器按哪一个计划日期生成 occurrence。
6. 完整 Issue 要求所有已配置约束同时满足；当前案例把总阅读时长按上限处理，PO 需确认这是上限还是目标区间，并确定难度 rubric、阅读时间估算、主题归类的可观察方法及不同主题间是否要求多样性。
7. 英文文章是否仅限英文原文，是否接受自动翻译后的英文内容；同一故事的转载/联合发布/镜像如何判定为重复，并如何呈现原始出版与可访问版本。
8. 批准的动态发现/全文服务、部署位置、凭据、成本上限、覆盖范围和服务故障责任；RSS 仅作为补充来源。
9. Reader 哪些文章内容获准本地缓存以支持离线、保存期限、清理入口及文章历史与 SayIt 查询历史的关联规则。
10. 目标浏览器、鼠标/触屏/键盘选择体验、阅读位置按滚动像素还是段落锚点恢复，以及跨重载/设备的保留范围。
11. 词典未命中单词时是否回退到 interpretation；Reader 中的本地单词查询是否写入 SayIt 历史；Save 是否需要扩展支持解释型结果。

## Sources

- Mozilla Readability 提取与误判说明：[README](https://github.com/mozilla/readability/blob/main/README.md)
- GDELT DOC API 发现接口背景：[GDELT DOC 2.0](https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/amp/)
- GDELT API 迁移和负载限制说明：[Scaling GDELT for a New Era](https://blog.gdeltproject.org/scaling-gdelt-for-a-new-era-migrating-to-spanner-with-agentic-interactive-gemini/)
- Google Custom Search JSON API 当前可用范围：[Overview](https://developers.google.com/custom-search/v1/overview)
- 浏览器选择范围：[Window.getSelection](https://developer.mozilla.org/en-US/docs/Web/API/Window/getSelection)、[Range.getBoundingClientRect](https://developer.mozilla.org/en-US/docs/Web/API/Range/getBoundingClientRect)
- 后台页面定时行为：[Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API)
