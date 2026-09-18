## Why

当前 IPA 是由 DeepSeek 生成并混入语义结果 contract，这让一个可选的发音元数据失败有机会触发整个结果校验失败，也把确定性的词典/G2P 工作错误地放进了 LLM 请求。SayIt 应让语义、发音转写和音频播放各自独立，这样切换口音可以本地完成，且发音不可用不会影响核心 Dogfood 流程。

## What Changes

- **BREAKING** 从 DeepSeek structured result contract 中移除 `pronunciation` 字段和所有 LLM IPA 校验逻辑。
- 从 DeepSeek system prompt 和相关 provider 测试中移除 IPA 输出要求。
- 增加独立的本地 pronunciation lookup abstraction：`getIPA(text, accent): Promise<string | null>`。
- 使用离线、确定性的 English dictionary/G2P engine 在浏览器本地生成 US/UK IPA，不新增 AI model 或后端 API。
- 按规范化表达和口音缓存成功的本地 IPA 结果；发音失败只返回 `null`。
- 保留现有 IPA UI 位置、US/UK selector、Normal/Slow Web Speech playback 和 contextual Listen/Copy actions。
- IPA 只服务于 primary expression、可用的 expression alternatives 和 primary interpreted expression；不为 Meaning、Usage/reference、Explanation、Example 或 UI labels 生成 IPA。
- 在实现前对 `phonemizer@1.2.1` 与 `phonemize@2.0.1` 做 golden-set bake-off；具体 engine、license/distribution 方案在评审前保持未决。

## Capabilities

### New Capabilities

- `local-pronunciation-lookup`: 在不访问 DeepSeek 或新增后端的情况下，为可学习英文表达提供可选的 US/UK IPA 转写、缓存和失败隔离。

### Modified Capabilities

无。现有 pronunciation playback 的音频行为保持不变；本 change 替换的是其 IPA 数据来源和语义 contract 耦合方式。

## Impact

- 修改 `src/shared/contract.ts`、DeepSeek provider prompt/测试和相关 fixture，移除 LLM pronunciation metadata。
- 新增浏览器端本地 engine adapter、lazy 初始化、IPA cache 和 lookup 测试；具体依赖由 bake-off 决策门确定。
- React 结果层从本地 lookup 获取 IPA，不再读取 API 结果中的 pronunciation 字段。
- 增加一个浏览器可加载的离线 phonemizer 依赖；不改变 `/api/retrieve`、server secret boundary 或 DeepSeek 请求职责。
