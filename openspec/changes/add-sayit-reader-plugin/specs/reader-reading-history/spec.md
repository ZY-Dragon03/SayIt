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

### Requirement: 成功交付的 Reader 全文必须可在应用内阅读

被标为 Reader 全文的 Daily Issue 文章 SHALL 在应用内提供经核验的正文阅读体验，不得仅显示标题、摘要或外部页面预览。

#### Scenario: PAT-RH-09 阅读已交付全文正文
- **GIVEN** Daily Issue 中有一篇标记为 Reader 全文的已核验文章
- **WHEN** 用户在 Reader 中打开该文章
- **THEN** 文章阅读面显示其正文段落并可连续滚动阅读；只有标题或摘要的内容不满足全文交付

### Requirement: Reader 恢复上次阅读的文章和位置

Reader SHALL 在用户离开 Reader 后返回时恢复上次打开的文章和已保存阅读位置。

#### Scenario: PAT-RH-10 返回 Reader 恢复文章位置
- **GIVEN** 用户在一篇已归档文章中阅读到中段，然后离开 Reader
- **WHEN** 用户再次进入 Reader
- **THEN** Reader 恢复此前打开的文章和对应阅读位置，用户可从该处继续阅读

### Requirement: 离线阅读仅限允许本地缓存的内容

Reader SHALL 允许离线打开已获准保存并已缓存正文的文章；缓存资格和外链候选 SHALL 清晰区分。

#### Scenario: PAT-RH-11 离线阅读获准缓存的正文
- **GIVEN** 本地已缓存一篇允许 Reader 保存的全文文章且设备离线
- **WHEN** 用户从 Reader 历史打开该文章
- **THEN** Reader 显示已缓存正文及阅读位置；未缓存或仅外链的候选不会被伪装成离线全文

### Requirement: 全文交付与仅外链候选必须明确区分

Reader SHALL 在每日清单和文章视图中区分可在应用内阅读的全文与只能跳转出版来源的候选。

#### Scenario: PAT-RH-12 显示外链候选状态
- **GIVEN** 某候选只有摘要或仅可从出版网站阅读
- **WHEN** 用户查看 Reader 每日清单
- **THEN** 候选显示为外链/摘要状态及实际可访问来源，不显示为 Reader 全文，也不计入完整 Issue 的目标篇数

### Requirement: 单词选择优先复用本地词典和发音能力

对单词选择，Reader SHALL 优先使用现有本地词典定义、IPA 和 Listen 能力，不得无条件把本地可查词条送入短语解释流程。

#### Scenario: PAT-RH-13 选择单词查看本地释义
- **GIVEN** 用户选中一个现有本地词典可查的单词
- **WHEN** 用户调用 Reader 上下文 SayIt
- **THEN** Reader 展示本地释义、现有 IPA 和 Listen 操作，且不发起短语/句子 interpretation；主 SayIt 工作区和会话上下文不变

### Requirement: 短语或句子选择复用解释并携带必要文章上下文

对短语或句子选择，Reader SHALL 调用现有 SayIt interpretation，并只传递理解所需的文章上下文；结果不得覆盖主 SayIt 工作区或会话上下文。

#### Scenario: PAT-RH-14 选择上下文相关短语
- **GIVEN** 用户选中一个需结合所在句子理解的短语或句子
- **WHEN** 用户调用 Reader 上下文 SayIt
- **THEN** SayIt 使用选中文本和必要的相邻文章语境返回 interpretation；关闭结果后原文章位置及主工作区状态不变

### Requirement: Regenerate 保留旧 edition 和阅读进度

Daily Issue Regenerate SHALL 创建同一日期 Issue 的新 edition，不得静默删除先前已交付的文章、edition 或进度。新 edition 中仍存在的文章沿用原进度；被替换的文章继续可从该日旧 edition 打开。

#### Scenario: PAT-RH-15 Regenerate 后保留文章与进度
- **GIVEN** 用户已阅读某篇文章并保存了阅读位置，且该文章属于已完成 Issue 的旧 edition
- **WHEN** 用户明确确认 Regenerate 并返回该日历史
- **THEN** 新 edition 成为当前版本；旧 edition 和原文章仍可访问，原文章的阅读状态及位置不变
