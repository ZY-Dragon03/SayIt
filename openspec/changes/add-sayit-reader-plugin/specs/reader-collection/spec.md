# Spec Delta

## Purpose

本能力为 Reader 定义持久化偏好、按时区运行的 Editorial Agent 收集、真实动态发现与 Daily Issue 履约状态，并诚实呈现全文可读性、来源版本、短缺和失败恢复。

## ADDED Requirements

### Requirement: 用户可配置阅读目标

系统 SHALL 允许用户配置阅读主题、每日文章数量、阅读难度、每日总阅读时长、每日收集时间和时区，并在 Reader 后续启动时保留这些偏好。

#### Scenario: PAT-RC-01 保存阅读偏好
- **WHEN** 用户修改任一阅读偏好并重新打开 Reader
- **THEN** Reader 显示最近保存的主题、篇数、难度、时长、收集时间和时区

### Requirement: 定时收集等待计划时间且不依赖 Reader 界面

收集服务 SHALL 按用户时区的计划时间执行；Reader 界面是否显示 SHALL 不影响计划检查。计划时间到达时服务不可用，系统 SHALL 在下一次服务或 SayIt 启动时补跑该 occurrence，且不得在计划时间前提前启动。

#### Scenario: PAT-RC-02 计划时间前启动 SayIt
- **GIVEN** Reader 已启用且计划时间为用户时区 18:00
- **WHEN** SayIt 或收集服务在当天 09:00 启动
- **THEN** 当天计划状态仍为待执行，计划尝试数为零，且没有已交付的计划 Daily Issue

#### Scenario: PAT-RC-03 到时但 Reader 界面未显示
- **GIVEN** SayIt 或收集服务正在运行，计划时间到达，Reader 界面未显示
- **WHEN** 系统检测到该用户时区 occurrence 到期
- **THEN** 系统启动一次定时尝试并更新计划状态，之后用户打开 Reader 可查看相同尝试和 Issue 状态

#### Scenario: PAT-RC-04 服务在计划时间不可用
- **GIVEN** 计划时间到达时电脑或收集服务不可用
- **WHEN** 电脑或服务之后启动
- **THEN** 系统对原计划 occurrence 标为待补跑并启动补跑，不把早先的启动时间误记为原计划时间

### Requirement: 计划状态、尝试记录和 Issue 履约状态分离

系统 SHALL 分别显示计划 occurrence 的进度、每次尝试的触发来源与结果、以及实际 Daily Issue 的完整/部分/未交付状态。启动尝试或完成尝试本身 SHALL NOT 表示完整 Issue 已成功履约。

#### Scenario: PAT-RC-05 定时失败的有界重试
- **GIVEN** 定时尝试遇到可重试故障
- **WHEN** 系统按评审建议执行首次尝试及最多两次自动重试
- **THEN** 每次尝试及其时间和结果可区分；重试不超过三次总尝试数，间隔建议为 5 分钟和 15 分钟；尝试失败不会显示为完整 Daily Issue，预算耗尽后明确显示计划未履约及无/部分 Issue 状态

### Requirement: Manual Run now 不改变计划运行

Reader SHALL 提供 Manual Run now；手动尝试 SHALL 标记为手动运行，不得重置、取消或消耗定时 occurrence 的计划时间或自动重试额度。

#### Scenario: PAT-RC-06 手动运行不改变未来计划
- **GIVEN** 已保存的定时 occurrence 尚未到期
- **WHEN** 用户选择 Manual Run now 并完成一次手动尝试
- **THEN** 手动结果明确标记为手动且不冒充定时 Daily Issue；原计划时间、计划状态和自动重试额度不变，计划到期后仍执行定时尝试

### Requirement: Editorial Agent 必须真实动态发现文章

Editorial Agent SHALL 从已保存偏好出发动态搜索候选，核验、去重和整理文章；验收及运行不得把预加载的固定文章 URL 列表作为完整发现输入。RSS 只能作为补充来源。

#### Scenario: PAT-RC-07 只给偏好的自主发现
- **GIVEN** 用户已保存主题、篇数、难度和阅读时长，验收环境提供实际在线发现能力但不给 Agent 预加载文章 URL 清单
- **WHEN** 定时收集或 Manual Run now 启动 Editorial Agent
- **THEN** Agent 自主生成并执行发现查询，取得候选，核验、去重并整理；验收证据可检查查询、发现的候选来源及其接受/拒绝原因，最终候选使用已保存偏好

### Requirement: 候选文章必须通过阅读核验和去重

系统 SHALL 核验候选正文、语言、来源版本和重复状态；同一故事的转载、联合发布、镜像或重复 URL SHALL NOT 占用多个目标篇数。

#### Scenario: PAT-RC-08 多来源重复报道去重
- **GIVEN** 动态发现得到多个来源 URL，但正文指向同一故事
- **WHEN** Editorial Agent 整理 Daily Issue
- **THEN** 该故事最多占一篇，且保留可验证的原始出版来源和实际可访问文章版本

#### Scenario: PAT-RC-09 原始出版来源不可访问
- **GIVEN** Agent 发现的原始出版页面无法访问
- **WHEN** Agent 尝试验证并恢复该候选
- **THEN** 它继续动态寻找可验证版本或替代文章；若找到同篇可访问版本，分别标示原始出版和实际访问链接；找不到时该候选不计为全文交付，并在 Issue 中如实显示短缺或外链状态

### Requirement: 来源归属必须区分原始出版与可访问版本

Reader SHALL 分别标示可验证的原始出版来源和实际可访问、供用户阅读的文章版本；替代文章 SHALL 使用其自身来源归属。

#### Scenario: PAT-RC-10 替换候选保留真实归属
- **GIVEN** 原候选不可访问且 Agent 找到另一篇可核验的相关文章
- **WHEN** Reader 用替代文章补充当日清单
- **THEN** Reader 显示替代文章自己的出版来源与可访问链接，且不声称它是不可访问的原候选

### Requirement: 收集失败必须可见且可恢复

系统 SHALL 保留先前归档，并区分尝试失败、部分 Daily Issue 和未交付；失败 SHALL 按计划 occurrence 的有界重试状态呈现。

#### Scenario: PAT-RC-11 离线收集
- **GIVEN** 定时或手动收集开始时设备离线
- **WHEN** Reader 无法联系发现或获取服务
- **THEN** 当前尝试显示失败且未履约，按有界重试规则显示后续状态，先前归档仍可用

#### Scenario: PAT-RC-12 部分达到阅读目标
- **GIVEN** 收集无法找到足够数量或符合阅读时长偏好的可核验全文文章
- **WHEN** Reader 完成该次收集
- **THEN** Reader 显示部分 Issue、实际合格篇数和未达到目标的状态，不以不可读候选补齐成功数量

### Requirement: 完整 Daily Issue 同时满足已保存偏好

完整 Daily Issue SHALL 同时满足用户配置的主题、目标篇数、难度和总估计阅读时长；只要任一约束未满足，系统 SHALL NOT 标记为完整履约。

#### Scenario: PAT-RC-13 完整 Issue 遵守全部偏好
- **GIVEN** 用户设置 Technology 与 Economy、目标 4 篇、Intermediate 难度和总阅读时长上限 20 分钟，且有足量合格全文候选
- **WHEN** 定时收集交付完整 Daily Issue
- **THEN** Issue 恰有 4 篇互不重复的 Reader 全文，每篇属于所选主题且符合所选难度，显示的估计总时长不超过 20 分钟

### Requirement: 供给不足不得静默放宽偏好

系统 SHALL 明确呈现未满足的阅读约束，不得为达成目标篇数而更改主题、降低难度、超出时长或纳入未核验全文。

#### Scenario: PAT-RC-14 目标冲突时不静默放宽
- **GIVEN** 有效供给无法同时满足主题、目标篇数、难度和时长上限
- **WHEN** 系统结束该次有界收集
- **THEN** 结果标为部分或未交付，列出实际数量和未满足的约束，且保存的用户偏好保持不变

### Requirement: 摘要候选不能冒充全文交付

系统 SHALL 将只可访问标题或摘要、无法核验正文的候选与 Reader 全文分开标记，且不计入完整 Issue 的篇数或阅读时间。

#### Scenario: PAT-RC-15 发现结果只有摘要
- **GIVEN** 候选网页只提供标题或摘要而无可核验正文
- **WHEN** Editorial Agent 验证并尝试补足 Issue
- **THEN** 候选标为外链/摘要候选并排除在全文目标外，Agent 继续搜索或明确报告部分供给

### Requirement: 来源消失时重新核验并恢复

候选原文在发现后、全文交付前不可用时，系统 SHALL 重新核验；已消失页面不得凭过期摘要或元数据标为可读全文。

#### Scenario: PAT-RC-16 来源在抓取前消失
- **GIVEN** 候选发现时可访问，但全文获取时来源已消失
- **WHEN** Editorial Agent 完成核验和恢复
- **THEN** 候选不计为 Reader 全文；Agent 搜索并核验替代版本或文章，若无合格替代则报告不足，且区分原始来源与实际版本
