# Spec Delta

## Purpose

定义 Reader 偏好、动态发现、文章核验和整理、单日 Daily Issue、时区调度、运行尝试、履约状态、来源归属与失败恢复。

## ADDED Requirements

### Requirement: 用户可配置阅读目标

系统 SHALL 允许用户配置并持久保存主题、每日目标篇数、阅读难度、总阅读时长预算、每日收集时间和 IANA 时区。Reader 默认关闭；保存偏好不要求 Reader 界面保持打开。

#### Scenario: PAT-RC-01 保存阅读偏好
- **WHEN** 用户修改任一阅读偏好、重启 SayIt 服务并重新打开 Reader
- **THEN** Reader 显示最近保存的主题、目标篇数、难度、阅读预算、收集时间和时区

### Requirement: 定时收集等待计划时间且不依赖 Reader 界面

收集服务 SHALL 按已保存时区和 occurrence 本地日期的计划时间运行；Reader 界面是否显示 SHALL 不影响调度。到达计划时间时主机/服务不可用，系统 SHALL 在下一次服务启动时只恢复当前日期 overdue occurrence。

#### Scenario: PAT-RC-02 计划时间前启动
- **GIVEN** Reader 已启用且计划时间为保存时区当日 18:00
- **WHEN** SayIt 服务在当日 09:00 启动
- **THEN** 当日 occurrence 保持 WAITING，attempt 数为零，且没有提前启动的 scheduled/catch-up attempt

#### Scenario: PAT-RC-03 到时但 Reader 界面未显示
- **GIVEN** SayIt 收集服务持续运行、Reader 界面关闭且当日 Issue 尚未 COMPLETE
- **WHEN** 保存时区的计划时间到达
- **THEN** 服务在 Reader 不可见时启动 scheduled attempt，之后打开 Reader 可查看相同 occurrence、attempt 和 Issue 状态

#### Scenario: PAT-RC-04 计划时服务不可用
- **GIVEN** 电脑或服务在当前日期计划时间关闭
- **WHEN** 当日计划时间之后服务重新启动
- **THEN** 系统针对当前日期启动 catch-up attempt，保留原计划时间和实际开始时间，不将其记为提前或按启动时刻新建计划

### Requirement: 计划 occurrence、run attempt 和 Daily Issue 履约状态分离

系统 SHALL 独立持久化 occurrence 状态、每个 attempt 的触发来源/时间/结果，以及当日 Daily Issue 的 COMPLETE、PARTIAL 或 NOT_DELIVERED 状态。一次 attempt 的启动或成功返回 SHALL NOT 单独表示 Issue 已完成。

#### Scenario: PAT-RC-05 定时故障有界重试
- **GIVEN** scheduled/catch-up attempt 遇到瞬时网络或服务故障
- **WHEN** retry policy 执行
- **THEN** occurrence 最多有三次 scheduled attempts（首次加两次重试，建议延迟 5 分钟和 15 分钟）；每次 attempt 可分别查看；永久候选访问/全文核验失败不反复抓取同一候选；预算耗尽后 occurrence 结束为未履约，Issue 仍如实显示 PARTIAL 或 NOT_DELIVERED

#### Scenario: PAT-RC-06 Manual Run 保持定时计划
- **GIVEN** 当日 occurrence 尚未到期且配置了未来计划
- **WHEN** 用户启动 Manual Run now 并完成收集
- **THEN** attempt 来源标为 manual，结果并入当日同一个 Daily Issue；occurrence 的计划时间和 scheduled retry budget 不变，未来日期也不变

### Requirement: Editorial Agent 从偏好真实动态发现

Editorial Agent SHALL 根据已保存主题等偏好动态构造并执行互联网发现查询，再获取候选、验证、去重和策展。固定 URL 清单或固定 RSS feed 清单 SHALL NOT 作为完整发现输入；RSS 仅可补充动态发现。

#### Scenario: PAT-RC-07 无预加载 URL 的真实发现
- **GIVEN** Agent 仅获得用户已保存偏好和可用在线发现能力，验收没有向 Agent 传入候选 URL 清单
- **WHEN** 用户启动 collection attempt
- **THEN** Agent 自行构造并执行在线查询，取得文章 URL 后继续获取和核验；trace 显示查询、候选来源、接受/拒绝原因和最终选择，选择使用已保存偏好

### Requirement: 去除文章副本但保留独立观点

系统 SHALL 将重复判定应用于文章内容而非仅应用于相同事件；拒绝相同规范 URL、正文相同、转载/镜像及近重复且无实质独立内容的文章。独立撰写的新闻报道或不同分析视角可以讨论同一事件。

#### Scenario: PAT-RC-08 同篇转载或镜像不重复占位
- **GIVEN** 候选中包含相同文章 URL、联合发布/转载、镜像或正文相同的多个版本
- **WHEN** Agent 整理 Daily Issue
- **THEN** 同一文章仅占一个篇数位置，并记录去重依据及保留版本的来源归属

### Requirement: 原文不可访问时诚实恢复

Reader SHALL 区分原创出版页面和实际可访问的全文版本。不能访问原文时，Agent 可寻找同一文章的可核验版本或独立替代文章；替代文章必须使用自身来源。无法核验全文的候选不得计入 Reader 全文。

#### Scenario: PAT-RC-09 原始出版页不可访问
- **GIVEN** Agent 发现的原始出版页面不可访问
- **WHEN** Agent 尝试恢复候选
- **THEN** 同篇可访问版本分别显示 Original publication 与 Accessible version；没有可核验版本时该候选不计全文且明确显示失败/短缺或外链状态

### Requirement: 替代文章使用自身来源归属

Reader SHALL 记录原候选的来源和实际服务文章的来源，不得把独立替代文章标为原文转载或同一文章的全文副本。

#### Scenario: PAT-RC-10 替换候选保留真实归属
- **GIVEN** 原候选不可访问且 Agent 找到不同的合格替代文章
- **WHEN** 替代文章进入当日清单
- **THEN** 清单显示替代文章自己的出版者和实际访问链接，并保留原候选不可用的原因

### Requirement: 收集失败可见并保留旧归档

Reader SHALL 区分尝试失败、部分 Issue 和未交付，不得因新的失败 attempt 清除之前的 Daily Issue、文章版本或进度。

#### Scenario: PAT-RC-11 离线收集
- **GIVEN** 用户启动 scheduled 或 Manual Run 时设备无法联网
- **WHEN** 发现服务不可达
- **THEN** 本次 attempt 显示失败与触发来源，后续状态遵守有限重试规则，既有归档仍可阅读

#### Scenario: PAT-RC-12 供给不足返回部分 Issue
- **GIVEN** Agent 无法找到足够合格全文满足全部偏好
- **WHEN** 本次允许尝试结束
- **THEN** Reader 显示 PARTIAL 或 NOT_DELIVERED、实际合格全文数量、阅读时长和未满足偏好，不以摘要/不适合文章补位

### Requirement: 完整 Issue 满足所有已保存目标

完整 Daily Issue SHALL 精确达到目标篇数；每篇均属于已选主题、符合已选难度；合格全文估计总时长 SHALL 在阅读预算的 70%–100% 范围内，100% 为硬上限。估计方法 SHALL 可复核且在界面可见。

#### Scenario: PAT-RC-13 完整 Issue 满足配置目标
- **GIVEN** 用户配置 Technology 与 Economy、目标 4 篇、Intermediate、20 分钟预算，且有足量合格全文
- **WHEN** Issue 标为 COMPLETE
- **THEN** Issue 恰含 4 篇不同全文，每篇属于所选主题并符合难度，总估计时长为 14–20 分钟且不超过 20 分钟

#### Scenario: PAT-RC-14 供给不足不静默降低标准
- **GIVEN** 合格候选无法同时满足篇数、主题、难度和 70%–100% 阅读预算
- **WHEN** 本次有限收集结束
- **THEN** Issue 为 PARTIAL 或 NOT_DELIVERED，逐项显示满足/未满足约束和估值，用户原设置不变，系统不标 COMPLETE

### Requirement: 摘要和消失页面不能冒充全文

只有标题/摘要、登录墙/付费墙、过期片段或在交付前已消失的页面 SHALL NOT 标为 Reader full text，也不得占用完整篇数或阅读时长。

#### Scenario: PAT-RC-15 发现结果只有摘要
- **GIVEN** 候选只提供标题/搜索摘要而无可核验正文
- **WHEN** Agent 验证候选
- **THEN** 候选标为外链/摘要并排除在全文目标之外；Agent 继续发现或报告供给不足

#### Scenario: PAT-RC-16 页面在抓取前消失
- **GIVEN** 候选发现时存在但全文抓取时已返回失效/不可访问页面
- **WHEN** Agent 重新核验并尝试恢复
- **THEN** 失效页面不计全文；使用经过核验且正确标注的版本或替代文章，否则报告 PARTIAL/NOT_DELIVERED

### Requirement: 手动和定时运行贡献同一日期 Issue

每个用户本地日期 SHALL 只有一个稳定 Daily Issue identity；manual、scheduled、catch-up 及其合格文章均归并至此 Issue。完整 Issue 满足全部目标后，计划 occurrence 到期不得冗余运行发现。

#### Scenario: PAT-RC-17 Manual Run 完成后计划运行识别已履约
- **GIVEN** Manual Run 已使当日 Daily Issue 达到 COMPLETE
- **WHEN** 同一日期的 scheduled occurrence 到期
- **THEN** occurrence 记为 ALREADY_FULFILLED 且不启动发现 attempt；当日仍只有同一个 Daily Issue identity

#### Scenario: PAT-RC-18 scheduled run 补齐手动部分 Issue
- **GIVEN** Manual Run 已创建当日 PARTIAL Issue
- **WHEN** scheduled occurrence 到期且尚有合格供给
- **THEN** scheduled attempt 只补充不重复且满足约束的文章，更新同一个 Issue identity；在全部目标满足后状态从 PARTIAL 变为 COMPLETE

#### Scenario: PAT-RC-19 手动运行不改变未来时刻和定时预算
- **GIVEN** 用户有下一 occurrence 日期/时间，或当前 occurrence 尚有 scheduled retry budget
- **WHEN** 用户执行一次或多次 Manual Run
- **THEN** 下一 occurrence 的本地日期、时区和时刻不变，scheduled attempt 数和重试预算不被手动 attempt 改写

#### Scenario: PAT-RC-20 已完成 Issue 不因普通手动运行被替换
- **GIVEN** 当日 Issue 已 COMPLETE
- **WHEN** 用户调用 Manual Run now
- **THEN** 系统说明 Issue 已完成并要求单独显式确认 Regenerate，不覆盖当前文章集合或进度

#### Scenario: PAT-RC-21 Regenerate 使用同一日期的递增版本
- **GIVEN** 用户明确确认对 COMPLETE Issue 执行 Regenerate
- **WHEN** 新集合被生成
- **THEN** 当前日期只有一个 Daily Issue identity，edition 递增；旧 edition 及旧文章仍可从该日历史打开

### Requirement: Catch-up 仅限当前日期的过期 occurrence

启动恢复 SHALL 至多执行当前用户本地日期已到期的一个 occurrence；不得为主机停机期间每个历史日期回补 Issue。历史 overdue occurrence 可记为 MISSED。

#### Scenario: PAT-RC-22 当日计划时间前重启
- **GIVEN** 服务在计划时间前关闭，并在同一日期计划时间前重启
- **WHEN** Scheduler 恢复
- **THEN** 不提前执行 catch-up，当前 occurrence 保持 WAITING 至计划时间

#### Scenario: PAT-RC-23 七日停机后只补跑今天
- **GIVEN** 服务连续七天不可用且今日计划时间已过
- **WHEN** 第七天之后服务启动
- **THEN** 前六个日期的 occurrence 可记录为 MISSED 但不调用发现；仅今天 overdue occurrence 可以 catch-up，且只生成今天的 Daily Issue

#### Scenario: PAT-RC-24 DST 跳时和重复时刻保持每日本地 occurrence 唯一
- **GIVEN** 用户配置的时区当天遇到夏令时跳时或重复时段
- **WHEN** Scheduler 计算计划 occurrence
- **THEN** 不存在的计划时刻顺延到当日首个有效时刻，重复时刻只执行一次，同一本地日不创建第二个 occurrence

### Requirement: 阅读时间和难度估计方法可观察

系统 SHALL 基于提取后的英文全文计算并保留估值输入及方法：每分钟 200 词的阅读时长，以及 Flesch–Kincaid Grade Level 公式与 Easy/Intermediate/Advanced 区间。

#### Scenario: PAT-RC-25 验证公开估算方法
- **GIVEN** 用户查看 Issue 或文章详情
- **WHEN** 用户查看预计阅读时间或难度说明
- **THEN** 界面可见正文词数、200 words/min 速率、FKGL 分数和当前区间；相同正文可复算出相同估值且明确标注为估计

### Requirement: 同一事件的独立报道和分析可以并列

Agent SHALL 判断文章内容重复而不是仅按 story/event key 合并。具备实质独立报道或分析内容的不同文章可以同时进入 Issue。

#### Scenario: PAT-RC-26 保留同一事件的独立观点
- **GIVEN** Reuters 对某次央行决策的新闻报道及另一出版物原创的深入分析都符合偏好
- **WHEN** 两篇文章正文内容独立且去重判断不认定为同文转载
- **THEN** 两篇可分别进入 Issue，并分别保留来源和观点/内容依据

#### Scenario: PAT-RC-27 拒绝无独立内容的近重复
- **GIVEN** 两篇报道只在标题/措辞上略有变化，正文 5-word shingle Jaccard 相似度达到 0.85 且无实质新增内容
- **WHEN** Agent 执行去重
- **THEN** 只保留一篇并记录近重复判据

#### Scenario: PAT-RC-28 主题或事件相同本身不触发去重
- **GIVEN** 两篇文章都讨论同一事件，但一篇是独立事实报道、一篇提供原创分析且正文相似度低于近重复阈值
- **WHEN** Agent 筛选候选
- **THEN** Agent 允许两篇参与后续偏好策展，不因共享事件或实体直接去重
