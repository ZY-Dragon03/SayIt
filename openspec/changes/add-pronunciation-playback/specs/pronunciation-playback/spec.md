## Purpose

为 SayIt 返回的自然英文表达提供轻量、即时且完全客户端的发音播放能力，帮助用户在理解表达后直接听到并模仿可用语言。

## ADDED Requirements

### Requirement: Playable result text

SayIt SHALL 在结果中为可播放的英文文本提供小型 speaker button，包括 retrieve 的最佳表达、useful expression、natural sentence，以及 interpret 的 expression 和非空 example。

#### Scenario: Play a retrieval best match

- **WHEN** retrieve 结果包含 Best match
- **THEN** 用户可以点击其 speaker button，浏览器播放该 Best match 文本

#### Scenario: Play a useful expression or natural sentence

- **WHEN** retrieve 结果包含 useful expression 或 natural sentence
- **THEN** 对应文本旁显示 speaker button，点击后播放对应文本

#### Scenario: Play an interpretation expression

- **WHEN** interpret 结果包含 expression 或非空 example
- **THEN** 对应字段旁显示 speaker button，点击后播放对应英文文本

### Requirement: Accent and speed preferences

系统 SHALL 支持 US (`en-US`) 和 UK (`en-GB`) 两种口音，以及 Normal (`1.0`) 和 Slow (`0.8`) 两种速度；默认值 SHALL 是 US 和 Normal。用户选择 SHALL 在当前浏览器本地保存，并在后续页面会话中恢复。

#### Scenario: Use default pronunciation preferences

- **WHEN** 浏览器中没有有效的 pronunciation preference
- **THEN** 系统使用 US locale 和 `1.0` rate

#### Scenario: Persist selected preferences

- **WHEN** 用户选择 UK 或 Slow
- **THEN** 系统立即使用新选择，并在下次页面会话恢复该选择

#### Scenario: Ignore invalid preference values

- **WHEN** 本地保存的 pronunciation preference 缺少字段或包含不支持的 accent/speed
- **THEN** 系统丢弃无效值并回退到对应默认值，不阻塞结果使用

### Requirement: Voice matching and fallback

系统 SHALL 使用浏览器 `speechSynthesis.getVoices()` 获取可用 voice，优先选择与所选 locale 精确匹配的 voice；没有精确匹配时 SHALL 回退到可用英文 voice，再没有时允许浏览器使用默认 voice。正常 UI MUST NOT 展示完整系统 voice 列表。

#### Scenario: Select exact locale voice

- **WHEN** 用户选择 US 或 UK 且可用 voice 包含对应 locale
- **THEN** 播放使用匹配所选 locale 的 voice

#### Scenario: Fall back when exact voice is unavailable

- **WHEN** 没有匹配所选 locale 的 voice 但存在其他英文 voice
- **THEN** 播放使用可用英文 voice，且不要求用户选择系统 voice

#### Scenario: Fall back to browser default

- **WHEN** 没有可用英文 voice
- **THEN** 系统仍尝试使用浏览器默认 voice，或显示本地播放错误；检索结果和其他操作保持可用

### Requirement: Replace previous playback

系统 SHALL 在播放新的表达前停止或取消当前 utterance，并 SHALL 只将当前播放请求报告为 playing；旧 utterance 的迟到完成或错误事件 MUST NOT 覆盖当前播放状态。

#### Scenario: Play another expression while speaking

- **WHEN** 一个表达正在播放且用户点击另一个 speaker button
- **THEN** 当前 utterance 被取消，新的表达立即开始播放

#### Scenario: Finish or fail current playback

- **WHEN** 当前 utterance 完成或发生播放错误
- **THEN** 对应 speaker button 离开 playing 状态，并显示基本错误状态（若发生错误），不影响结果内容

### Requirement: Client-only and graceful unsupported behavior

Pronunciation playback SHALL 仅在浏览器中执行，不得新增后端请求、API key、语音输入、录音、speech recognition 或 pronunciation scoring。浏览器不支持 Web Speech API 时，系统 SHALL 显示清晰的本地不可用状态，同时保留复制、保存、Retry 和检索功能。

#### Scenario: Browser does not support speech synthesis

- **WHEN** 当前浏览器没有 `window.speechSynthesis`
- **THEN** speaker action 显示不可用或失败提示，不发送网络请求，结果页面仍可正常使用

#### Scenario: Playback error does not destroy result

- **WHEN** speech synthesis 返回 error
- **THEN** 系统保留当前输入和结果，并允许用户继续复制、保存、Retry 或播放其他文本
