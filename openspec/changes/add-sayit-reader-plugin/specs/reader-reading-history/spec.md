# Spec Delta

## Purpose

本能力定义 Reader 的沉浸式每日阅读、文章内选词调用 SayIt、阅读位置恢复，以及与 SayIt 交互历史分开的本地文章归档和阅读进度。

## ADDED Requirements

### Requirement: Reader 提供专注的文章阅读界面

Reader SHALL 提供每日阅读清单和专注的文章阅读界面，显示文章标题、来源归属、预计阅读时间和阅读状态，并遵循低标签、低干扰的 Quiet Fluent Utility 视觉方向。

#### Scenario: PAT-RH-01 从每日清单开始阅读
- **GIVEN** 当日归档中有已核验的全文文章
- **WHEN** 用户打开 Reader 每日清单并选择一篇文章
- **THEN** Reader 显示文章内容、标题、实际来源链接、预计阅读时间和当前阅读状态

### Requirement: 选择文章文本调用现有 SayIt 能力

Reader SHALL 允许用户选择文章中的单词、短语或句子来调用现有 SayIt 检索或解释能力，并复用 SayIt 已有的 IPA、语音、Save 和 Copy 能力；Reader 不得复制或另建 SayIt 检索引擎。

#### Scenario: PAT-RH-02 选择文本查看 SayIt 结果
- **GIVEN** 用户正在 Reader 文章中阅读
- **WHEN** 用户选择单词、短语或句子并调用 SayIt
- **THEN** Reader 将所选文本交给现有 SayIt 能力，并展示相应结果及该结果支持的 IPA、语音、Save 和 Copy 操作

#### Scenario: PAT-RH-03 空选择不触发检索
- **GIVEN** 用户正在文章中阅读
- **WHEN** 当前没有选中文本并调用上下文 SayIt 操作
- **THEN** Reader 不发起空文本检索，并保留文章内容和阅读位置

### Requirement: 上下文结果不覆盖文章或主 SayIt 会话

Reader 展示上下文 SayIt 结果期间 SHALL 保留文章内容和进入 Reader 前的 SayIt 输入、结果与会话上下文。

#### Scenario: PAT-RH-04 关闭上下文结果后继续阅读
- **GIVEN** 用户在文章中段选择文本并打开 SayIt 结果
- **WHEN** 用户关闭该结果
- **THEN** 同一文章仍在原阅读位置显示，且原 SayIt 主输入与结果状态不变

### Requirement: Reader 保存本地文章历史和阅读进度

Reader SHALL 将每日已交付文章、其原始来源、日期和用户阅读进度保存为本地文章历史；该文章历史 SHALL 与 SayIt 的交互历史和已保存表达区分。

#### Scenario: PAT-RH-05 退出后恢复文章进度
- **GIVEN** 用户已打开一篇归档文章并阅读到文中位置
- **WHEN** 用户关闭 Reader 后再次打开该文章
- **THEN** Reader 显示该文章的已存阅读状态和阅读位置

#### Scenario: PAT-RH-06 查看往日文章归档
- **GIVEN** 本地保存了多个日期的 Reader 文章集合
- **WHEN** 用户打开 Reader 历史
- **THEN** 用户可按日期查看此前文章及其阅读进度和原始来源

### Requirement: Reader 中的 SayIt 查询进入现有交互历史

Reader 发起并成功完成的 SayIt 交互 SHALL 按照普通 SayIt 成功交互记录到现有 SayIt 交互历史；文章归档仍独立保存文章级来源和阅读进度。

#### Scenario: PAT-RH-07 从 SayIt 历史恢复 Reader 查询
- **GIVEN** 用户在 Reader 中成功查询选中文本
- **WHEN** 用户之后打开 SayIt 现有交互历史
- **THEN** 该成功查询以普通 SayIt 历史项出现并可恢复

### Requirement: Reader 历史在离线时可读取

Reader SHALL 在无法联网时允许用户查看此前保存在本地的文章归档和阅读进度。

#### Scenario: PAT-RH-08 离线查看已归档内容
- **GIVEN** 设备离线且本地存在已归档 Reader 记录
- **WHEN** 用户打开 Reader 历史
- **THEN** Reader 显示本地可用的文章记录和阅读状态，并将无法联网的新收集状态与旧归档区分
