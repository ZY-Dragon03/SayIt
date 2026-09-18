## Why

SayIt 现在已经能返回可用的英文表达和语境解释，但用户仍需要离开结果区、自己朗读或打开其他工具确认发音。对于最佳表达、自然句和文化引用，单击播放能把“理解 -> 模仿 -> 使用”压缩成同一个轻量循环，是适合 Dogfood 的下一个小能力。

## What Changes

- 增加客户端 pronunciation playback，使用浏览器原生 Web Speech API，不增加后端 endpoint、云端 TTS 或 API key。
- 为 Best match、Useful expressions、Natural version、Interpretation expression 和可选 Example 提供小型 speaker button。
- 支持 US (`en-US`) 和 UK (`en-GB`) 两种口音，默认 US；根据 locale 选择最佳可用系统 voice，并在没有精确匹配时回退到英文或默认 voice。
- 支持 Normal (`1.0`) 和 Slow (`0.8`) 两种速度。
- 在轻量设置区域保存口音和速度偏好，使其跨页面会话保留。
- 播放新表达前取消上一条 utterance，并提供基本播放中/失败状态。
- 保持 pronunciation client-side、可替换，不加入 speech input、speech recognition、recording、scoring 或 Production Hardening。

## Capabilities

### New Capabilities

- `pronunciation-playback`: 使用浏览器原生语音合成播放 SayIt 返回的可用英文表达，并管理口音、速度、voice fallback 和轻量播放状态。

### Modified Capabilities

无。现有 retrieve、interpret、session context 和 local expression memory 的结果契约不改变。

## Impact

- 新增客户端 pronunciation helper/hook、偏好 localStorage 和播放控件。
- React 结果 renderer 与顶部轻量设置区域会增加 speaker actions，但 API、provider、server secret boundary 和 DeepSeek 请求不变。
- 浏览器不支持 Web Speech API 或没有可用 voice 时，结果仍可正常复制、保存和使用，只显示可理解的本地错误/不可用提示。
