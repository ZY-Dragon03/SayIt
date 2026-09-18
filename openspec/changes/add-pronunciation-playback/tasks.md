## 1. Pronunciation 基础

- [x] 1.1 增加版本化 pronunciation preference 类型、默认值和 localStorage 读写，并验证无效值回退到 US/Normal 且存储失败不阻塞使用
- [x] 1.2 实现可替换的浏览器 pronunciation service，使用 SpeechSynthesisUtterance、`1.0`/`0.8` rate 和 `en-US`/`en-GB` locale，并验证服务不产生后端请求
- [x] 1.3 实现精确 locale、英文 voice、浏览器默认 voice 的三级选择和旧 utterance 事件隔离，并用 speechSynthesis mock 验证 fallback 与 cancel-before-speak

## 2. SayIt UI 集成

- [x] 2.1 在页面轻量设置区域加入 US/UK 与 Normal/Slow 控件，并验证选择立即生效且刷新后恢复
- [x] 2.2 增加可复用 speaker button，在 retrieve 的 Best match/useful expression/natural sentence 和 interpret 的 expression/example 旁显示，并验证按钮可访问名称与 playing 状态
- [x] 2.3 接入当前结果 renderer 的播放错误与不可用状态，并验证播放失败后输入、结果、Copy、Save 和 Retry 仍可用
- [x] 2.4 保持 meaning、usage/reference 等非目标文本不增加重复控件，并验证 UI 不展示原始系统 voice 列表、不出现 speech input 或 recording 控件

## 3. 文档与验证

- [x] 3.1 更新 README 的 Daily use/Pronunciation 说明，明确浏览器支持、US/UK、Normal/Slow 和无云端 TTS
- [x] 3.2 运行 typecheck、全部 Vitest 和 build，确认既有 retrieve/interpret/session-context 流程未回归
- [ ] 3.3 在支持 Web Speech API 的 Windows 浏览器手动验证 retrieve、interpret、example、切换播放、口音/速度持久化和不支持 API 的 graceful fallback
