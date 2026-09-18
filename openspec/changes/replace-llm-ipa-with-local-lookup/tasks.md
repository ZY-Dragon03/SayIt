## 0. Engine decision gate

- [x] 0.1 在隔离临时目录运行 `phonemizer@1.2.1` 与 `phonemize@2.0.1` 的相同 golden set，并记录 IPA、US/UK 差异、Vite bundle/load、延迟、包体积和依赖信息
- [x] 0.2 评审 eSpeak NG GPL-3.0-or-later bundled-code 风险、`phonemize` MIT/transitive licenses 和 golden-set 质量；批准 `phonemizer@1.2.1` 仅用于私有/本地 Dogfood，公开分发保持 blocked
- [x] 0.3 确定 Dogfood 的 lightweight filtering：空输入/明显非语言或代码样式输入/空输出/engine failure 返回 `null`；不加入 numeric confidence、额外 dictionary 或 service，未知词 guess 可接受

## 1. Semantic contract cleanup

- [x] 1.1 从 shared contract、result types、fixtures 和 storage 相关类型中移除 LLM pronunciation metadata，并验证没有 result schema 依赖该字段
- [x] 1.2 从 DeepSeek system prompt 和 provider tests 中移除 IPA 输出要求与 LLM IPA validation，并验证 retrieve/interpret 的无 pronunciation JSON 都能通过
- [x] 1.3 保留现有 IPA UI 所需的本地显示类型，但验证语义 API response 不包含 pronunciation 且 invalid/absent pronunciation 不再触发 provider repair

## 2. Local pronunciation service

- [x] 2.1 固定安装 `phonemizer@1.2.1` 及 browser 入口，记录私有/本地 Dogfood 限制、license 风险、bundle 资产和 Windows launcher 不需要额外原生安装
- [x] 2.2 实现 `getIPA(text, accent): Promise<string | null>` adapter，使用 lazy engine 初始化、`us -> en-us`、`uk -> en` 映射和 slash-delimited 输出，并验证 engine 失败返回 null
- [x] 2.3 增加按规范化 expression + accent 的 bounded local cache，并验证相同 key 复用、US/UK 隔离、并发请求去重和 cache 失败回退
- [x] 2.4 为 Road House、普通单词/短语、未知表达和 US/UK 输出增加 deterministic lookup tests，验证不产生网络或 DeepSeek 请求

## 3. UI 接入与隔离

- [x] 3.1 让 primary retrieve expression、可用 alternatives 和 primary interpretation expression 从本地 lookup 加载 IPA，并验证现有 IPA 位置和 muted hierarchy 保持不变
- [x] 3.2 让 accent 切换只触发本地 IPA lookup 和现有 Web Speech voice 更新，并验证不触发新的 `/api/retrieve` 请求
- [x] 3.3 验证 Meaning、Usage/reference、Explanation、Example 和 UI labels 不会触发或显示 IPA，且 IPA 不可用时只隐藏 metadata
- [x] 3.4 验证 IPA lookup 失败、加载中或 cache 异常不影响 retrieve、interpret、Copy、Save、session context 和 Web Speech playback

## 4. Verification and Dogfood

- [x] 4.1 运行 typecheck、全部 Vitest 和 build，确认 provider、contract、storage、interpretation/context 流程未回归
- [x] 4.2 在 Windows browser 中手动验证 Road House 的 US/UK IPA、普通 retrieve expression、accent 切换无 DeepSeek 请求、重复 lookup 命中 cache 和本地 engine 不可用时的 graceful fallback
