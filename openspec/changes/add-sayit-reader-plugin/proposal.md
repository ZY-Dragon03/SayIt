# Proposal

> **冻结产品契约 v1.0。** 产品负责人已明确批准本变更中的产品语义及 A–D 决策，并授权在本文档一致化、严格校验后冻结并直接实施。验收含义冻结后不得在实现中擅自改变。

## Why

SayIt 帮助用户理解其主动提交的英语表达，但日常寻找合适的英语阅读材料仍需用户手动完成。SayIt Reader 是可选阅读插件：Editorial Agent 根据已保存偏好自主发现、核验、去重并整理可在应用内阅读的英文原文，用户可在文章中复用 SayIt 能力。

## What Changes

- 新增默认关闭、可单独启用的 Reader。Reader 激活时隐藏 SayIt 主输入和检索工作区；退出后恢复原输入、结果、会话上下文与界面状态。
- 用户可保存主题、每日全文目标篇数、阅读难度、每日阅读时长预算、时区和收集时间，并可 Manual Run now。
- Editorial Agent 必须根据偏好动态查询互联网、获取候选、核验全文、去重并整理；不得把固定 URL 清单或静态 RSS 清单当作完整发现输入。RSS 可补充发现。
- 每个用户本地日只有一个 Daily Issue。Manual Run now 与 scheduled occurrence 合并到同一 Issue；完整 Issue 会抑制定时重复发现，部分 Issue 可由之后的 scheduled run 补足。Manual Run 不修改未来计划。完成的 Issue 只有显式 Regenerate 才可替换；旧版本、已交付文章和阅读进度均保留。
- 调度按偏好时区执行且不依赖 Reader 是否显示。计划前不得提前运行。主机不可用时仅补跑当前日期已过期的 occurrence；更早遗漏的日期标记 MISSED，不追溯生成旧 Issue。每个 occurrence 首次加两次自动重试，建议间隔 5 和 15 分钟；仅瞬时故障重试。
- 计划 occurrence、run attempt 和 Daily Issue 履约状态独立记录。启动或完成一次尝试不代表 Issue 完整履约。
- 完整 Issue 必须满足选定主题、精确目标篇数、难度和阅读时长目标。时长是目标区间：以预算的 70% 为下界，100% 为硬上限。供给不足时标为 PARTIAL 并列出缺项，不得静默放宽偏好。
- 难度以文章正文的 Flesch–Kincaid Grade Level 估计：Easy ≤ 8，Intermediate > 8 且 ≤ 12，Advanced > 12；阅读时长按正文词数 ÷ 200 词/分钟估计。界面显示使用的方法与估值，均标为估计。
- 去重对象是文章内容而不是事件：相同规范 URL、相同正文、转载/镜像和近重复且无实质独立内容的版本只能占一个位置；同一事件的独立报道或不同分析视角可以并列。
- 保留 Original publication 与实际 Accessible version 的来源归属。不能访问、只有摘要、登录/付费墙阻挡或全文无法核验时，不得声称已交付 Reader 全文。
- Reader 提供实际可读的应用内正文、每日归档、进度与允许离线使用的本地缓存。未知缓存许可的全文不持久化；明确获准缓存的内容可离线续读。
- 单词选择优先复用本地词典、IPA、Listen；短语/句子选择复用现有 SayIt interpretation 并附必要文章语境。上下文结果不能改写主 SayIt 工作区或会话。
- Reader 文章归档和进度与现有 SayIt 交互历史分离；Reader 内成功的 SayIt interpretation 仍进入原有交互历史。不得复制 SayIt 引擎。

## F1–F10 产品范围

F1 Plugin Mode；F2 Reading Preferences；F3 Autonomous Discovery；F4 Scheduled/Manual Run；F5 Article Curation；F6 Reading Workspace；F7 Inline SayIt；F8 Daily Archive；F9 Failure Handling；F10 Plugin Isolation。范围保留，不新增候选功能。

## Product Acceptance Cases

完整产品验收契约为 49 个可观察 PAT：PAT-RM-01–06（6 项）、PAT-RC-01–28（28 项）、PAT-RH-01–15（15 项）。原 36 项中未被本次明确修订的有效含义保留；PAT-RC-02–06、08、13–14 按本合同收敛，新增的 PAT-RC-17–28 和 PAT-RH-15 覆盖 A–D。

产品验收必须绑定到最终集成候选，逐项记录 PASS/FAIL/NOT-RUN 和证据。工程测试或构建成功不能替代 PAT 验收。必须至少完成一次真实网络 Editorial Agent 收集，以及一次真实文章选择到 SayIt interpretation 的交互。

## Product Decisions and Engineering Decisions

产品语义以上述冻结条款和 delta specs 为准。发现服务、HTTP/API 适配、调度器实现、存储技术、HTML 清理与本地部署属于工程决策；优先复用本地基础设施和低成本/免费能力，不得在未经批准时承诺新的付费外部服务。

## Capabilities

### New Capabilities

- reader-plugin-mode：可选启用、模式切换、界面隔离、恢复 SayIt 会话。
- reader-collection：偏好、真实动态发现、文章验证和整理、每日 Issue、计划/尝试/履约、来源标注及失败处理。
- reader-reading-history：应用内阅读、内联 SayIt、版本化归档、位置和进度、合法缓存和离线阅读。

### Modified Capabilities

无。当前主 specs 中没有相关 capability；本变更新增以上三项。
