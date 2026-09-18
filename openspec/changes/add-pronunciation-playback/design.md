## Context

SayIt 的结果已经在浏览器中按 retrieve/interpret 两种 mode 渲染，当前可复制和保存，但没有发音能力。本变更只扩展客户端交互，不改变 `/api/retrieve`、结构化结果、provider abstraction、session context 或 server-side secret boundary。

## Goals / Non-Goals

**Goals:**

- 用 `window.speechSynthesis` 和 `SpeechSynthesisUtterance` 播放结果中的英文文本。
- 为可用表达提供一致的小 speaker button，并让播放中的按钮有明确状态。
- 提供 US/UK 口音和 Normal/Slow 两个最小偏好，默认 US/Normal，并持久化到当前浏览器。
- 选择精确 locale voice，依次回退到其他英文 voice，再回退到浏览器默认 voice。
- 播放新文本前取消旧 utterance；API 不可用或播放失败时不影响其他结果操作。
- 通过独立 pronunciation service boundary 保留未来替换神经 TTS 的可能性。

**Non-Goals:**

- 不新增服务端 API、云端 TTS、密钥、录音、speech input、speech recognition 或 pronunciation scoring。
- 不展示系统完整 voice 列表，不增加音频队列、进度条、历史或播放器页面。
- 不修改 retrieve/interpret 结果契约或 localStorage saved expression 数据结构。
- 不开始 Production Hardening。

## Decisions

### 1. 采用浏览器原生 Web Speech API

增加客户端 pronunciation service，依赖最小的 `SpeechSynthesis` 能力：

1. 从 localStorage 读取 accent/speed 偏好，缺失或损坏时使用 US/Normal。
2. 播放前调用 `speechSynthesis.cancel()`，创建新的 `SpeechSynthesisUtterance(text)`。
3. 设置 `utterance.lang` 为 `en-US` 或 `en-GB`，设置 `utterance.rate` 为 `1.0` 或 `0.8`。
4. 通过 `speechSynthesis.getVoices()` 选择首个精确 locale voice；若没有，则选择任意 `en-*` voice；仍没有时不设置 voice，让浏览器使用默认 voice。
5. 使用 `onstart`、`onend`、`onerror` 更新播放状态，并忽略旧 utterance 的迟到事件。

选择原生 API 是因为无需 key、无需网络、适合 Dogfood。将 service 与 UI 解耦，使未来可替换为神经 TTS，而不让结果 renderer 直接依赖具体 provider。

### 2. 偏好采用小型版本化 localStorage

使用独立 key `sayit.pronunciation.v1` 保存：

```json
{
  "accent": "us",
  "speed": "normal"
}
```

UI 只展示 US/UK 和 Normal/Slow 两个选项，不展示原始系统 voice 列表。偏好写入失败时继续使用当前会话设置，不阻塞播放。

### 3. 统一 speaker action，按结果类型注入文本

新增可复用的 `SpeakButton`：

- retrieve `best_match.text`；
- 每个 useful expression 的 `text`；
- retrieve `natural_sentence`；
- interpret `interpretation.expression`；
- 非空 interpret `example`。

按钮只显示小型 speaker icon 和可访问名称；播放中显示 active/playing 状态。Meaning 和 Usage/reference 默认不单独播放，避免结果区出现过多控制；用户仍可复制这些解释。

口音和速度设置放在 topbar 的小型 pronunciation control 中，不进入每个结果卡片。

### 4. 错误和兼容策略

浏览器不支持 `speechSynthesis`、voice 尚未可用或 utterance 发生 error 时，服务只返回本地可读错误状态。结果、复制、保存、Retry 和 session context 不受影响。播放失败不发送 API 请求，也不把系统 voice 信息写入服务端。

## Risks / Trade-offs

- [浏览器 voice 列表异步或平台差异] → 每次播放重新读取 `getVoices()`，精确 locale、英文 voice、默认 voice 三级回退。
- [浏览器合成音质量不一致] → Dogfood 先接受系统 voice；独立 service boundary 为未来神经 TTS 保留替换点。
- [连续点击造成 utterance 竞态] → 每次新播放先 `cancel()`，并用当前 utterance token 忽略旧事件。
- [localStorage 不可用] → 内存中继续使用默认/当前偏好，不影响核心检索和结果操作。
- [结果区控制变多] → 只增加 icon button，解释字段不重复增加播放控件，设置集中到 topbar。

## Migration Plan

1. 增加 pronunciation preferences schema、voice selection helper 和 browser service，不改现有 API。
2. 在 App 中加载偏好、接入 speaker buttons 和 topbar settings。
3. 增加 Web Speech mock、voice fallback、preference persistence、cancel-before-speak 和 error state 测试。
4. 运行 typecheck、Vitest、build，并在支持 Web Speech API 的 Windows 浏览器中手动播放 retrieve/interpret 文本。
5. 若浏览器不支持该 API，保留检索功能并显示不可用提示；无需数据迁移或服务端回滚。
