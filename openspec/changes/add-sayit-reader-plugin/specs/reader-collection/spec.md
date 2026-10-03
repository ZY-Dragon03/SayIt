# Spec Delta

## Purpose

本能力为 Reader 定义用户偏好、每日文章发现和整理、只在 SayIt 打开期间执行的自动与手动收集，以及对全文可读性、来源归属和失败状态的诚实呈现。

## ADDED Requirements

### Requirement: 用户可配置阅读目标

系统 SHALL 允许用户配置阅读主题、每日文章数量、阅读难度、每日总阅读时长、每日收集时间和时区，并在 Reader 后续启动时保留这些偏好。

#### Scenario: PAT-RC-01 保存阅读偏好
- **WHEN** 用户修改任一阅读偏好并重新打开 Reader
- **THEN** Reader 显示最近保存的主题、篇数、难度、时长、收集时间和时区

### Requirement: 自动收集受 Reader 打开状态约束

系统 SHALL 以用户设置的时区确定每日边界和计划时间，并且 SHALL 只在 SayIt 打开期间启动自动收集。**本评审草案建议：** 若打开 SayIt 时当天尚无已启动的收集尝试，系统立即补跑，不等待计划时间；若应用一直开着且到达计划时间时当天仍无已启动尝试，则启动一次计划收集。用户明确执行 Manual Run now 可再次运行；任何已启动的尝试（包括失败尝试）均抑制当天之后的自动运行。此调度解释仍待产品负责人确认。

#### Scenario: PAT-RC-02 打开时当天尚无运行记录
- **GIVEN** Reader 已启用，用户时区的当天没有已启动的收集尝试
- **WHEN** 用户打开 SayIt
- **THEN** 系统在 SayIt 打开后启动一次 Reader 收集，并为该用户时区的当天记录尝试和运行状态

#### Scenario: PAT-RC-03 SayIt 关闭期间到达计划时间
- **GIVEN** SayIt 已关闭，用户时区的计划收集时间到达
- **WHEN** 该计划时间过去且 SayIt 仍未打开
- **THEN** 系统不在后台启动收集；用户之后打开 SayIt 且当天没有已启动尝试时，系统按 PAT-RC-02 补跑

#### Scenario: PAT-RC-04 SayIt 早于计划时间打开
- **GIVEN** Reader 已启用，SayIt 在用户时区的计划时间前打开，且当天没有收集尝试
- **WHEN** SayIt 完成启动检查
- **THEN** 系统立即启动一次补跑，记录本地日期和运行状态；当天到达计划时间时不再自动重复运行

#### Scenario: PAT-RC-05 SayIt 打开期间到达计划时间
- **GIVEN** SayIt 保持打开，用户设置的计划时间到达，且当天没有已启动的收集尝试
- **WHEN** 系统检测到计划时间已到
- **THEN** 系统在 SayIt 打开期间启动一次自动收集

### Requirement: 用户可手动运行收集

Reader SHALL 在 SayIt 打开时提供 Manual Run now 操作，并在手动收集期间和完成后显示可观察的运行状态。

#### Scenario: PAT-RC-06 手动立即收集
- **GIVEN** Reader 已启用且 SayIt 已打开
- **WHEN** 用户选择 Manual Run now
- **THEN** Reader 启动一次手动收集，并显示运行中、完成、部分完成或失败状态

### Requirement: 发现必须动态查询内容

收集流程 SHALL 根据用户主题动态查询文章候选；系统不得仅依赖随应用硬编码且不会动态更新的 RSS 来源清单。

#### Scenario: PAT-RC-07 新候选来源进入阅读清单
- **GIVEN** 动态发现返回主题相关且符合其余整理条件的新来源文章
- **WHEN** Reader 完成候选核验
- **THEN** 符合条件的文章可进入当日清单，且其来源和原始文章链接被保留

### Requirement: 候选文章必须通过阅读核验和去重

系统 SHALL 核验候选的文章内容、语言和重复状态；同一篇文章的重复 URL 或重复抓取 SHALL 不会作为多篇文章重复交付。

#### Scenario: PAT-RC-08 重复文章被去重
- **GIVEN** 同一文章以多个追踪 URL 或候选记录出现
- **WHEN** Reader 整理当日清单
- **THEN** 当日清单中最多显示一份该文章记录，并保留其可验证的原始来源

#### Scenario: PAT-RC-09 原文全文不可读
- **GIVEN** 候选原文无法访问，或只能取得无法核验为完整文章的片段
- **WHEN** Reader 完成当日清单整理
- **THEN** 该候选不会被标记为成功交付的全文文章，且用户可以看到不可读或未核验状态

### Requirement: 来源归属必须对应实际交付文章

每篇成功交付的全文文章 SHALL 保留指向实际原始出版来源的链接；替换文章 SHALL 使用其自身来源和归属，不能沿用不可访问候选的来源信息。

#### Scenario: PAT-RC-10 不可访问候选被替换
- **GIVEN** 原候选不可访问且 Reader 找到另一篇可核验的相关文章
- **WHEN** Reader 用替代文章补充当日清单
- **THEN** 替代文章显示自己的原始出版来源和链接，且不声称其为不可访问的原候选

### Requirement: 收集失败必须可见且可恢复

系统 SHALL 区分收集中、成功、部分完成和失败状态；收集失败时 SHALL 保留先前归档，并为用户提供重试或再次手动运行的入口。

#### Scenario: PAT-RC-11 离线收集
- **GIVEN** SayIt 已打开但设备离线
- **WHEN** Reader 自动或手动启动收集
- **THEN** Reader 显示失败状态和重试入口，且先前每日归档仍可阅读

#### Scenario: PAT-RC-12 部分达到阅读目标
- **GIVEN** 收集无法找到足够数量或阅读时长符合偏好的可核验全文文章
- **WHEN** Reader 完成该次收集
- **THEN** Reader 显示实际可读数量和未达到目标的状态，不以不可读候选补齐成功数量
