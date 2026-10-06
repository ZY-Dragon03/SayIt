# Spec Delta

## Purpose

本能力为 SayIt 提供可独立启用的 Reader 模式，并定义 Reader 与现有 SayIt 工作区之间的清晰进出边界，使用户能够阅读文章而不丢失原有会话状态。

## ADDED Requirements

### Requirement: Reader 模式可选启用

系统 SHALL 提供明确的 Reader 启用和关闭入口；Reader 未启用时，原有 SayIt 工作区 SHALL 可正常使用。

#### Scenario: PAT-RM-01 Reader 未启用
- **WHEN** 用户没有启用 Reader
- **THEN** SayIt 显示原有主要输入和检索工作区，且不显示 Reader 阅读界面

#### Scenario: PAT-RM-02 用户进入 Reader
- **WHEN** 用户从 SayIt 工作区启用 Reader
- **THEN** 系统切换到 Reader 界面，且 Reader 数据与偏好不改变原有 SayIt 数据

### Requirement: Reader 激活时隔离原工作区

Reader 激活时，系统 SHALL 隐藏且停用 SayIt 的主要输入和检索工作区，并显示 Reader 的每日阅读清单或文章阅读界面。

#### Scenario: PAT-RM-03 Reader 主界面
- **WHEN** Reader 已激活且当前没有打开文章
- **THEN** 用户看到 Reader 每日阅读清单，不能误操作被隐藏的 SayIt 主输入

#### Scenario: PAT-RM-04 Reader 文章界面
- **WHEN** 用户从阅读清单打开一篇文章
- **THEN** 系统显示沉浸式文章阅读界面，且 SayIt 主输入和结果工作区保持隐藏

### Requirement: 关闭 Reader 后恢复原 SayIt 状态

系统 SHALL 在 Reader 关闭后恢复进入 Reader 前的 SayIt 可见会话状态，包括主输入、结果、会话上下文和当前界面偏好。

#### Scenario: PAT-RM-05 往返后恢复会话
- **GIVEN** SayIt 中已有输入、结果和会话上下文
- **WHEN** 用户进入 Reader、打开文章、查看一次上下文结果后关闭 Reader
- **THEN** 原有 SayIt 输入、结果和会话上下文仍可见且未被 Reader 查询替换

### Requirement: 关闭 Reader 不删除其数据

关闭或停用 Reader SHALL 保留已归档的文章、阅读进度和 Reader 偏好；只有用户明确执行数据清除操作时才可删除这些记录。

#### Scenario: PAT-RM-06 关闭后保留阅读数据
- **GIVEN** Reader 已保存每日文章和阅读进度
- **WHEN** 用户关闭 Reader 并在之后重新启用
- **THEN** 已保存的 Reader 文章和进度仍可从本地归档中查看
