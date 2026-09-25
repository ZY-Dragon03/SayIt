## Why

Dogfood 使用一段时间后，SayIt 在「找回刚才的结果」「阅读解释性英文时查词发音与释义」以及「结果区块视觉一致性」上仍明显不足：Saved 只适合长期收藏，无法自动回顾近期交互；Meaning / Usage / Example / Explanation 的样式与交互不统一；解释性段落里的生词缺少 **即时、本地、保持英语沉浸** 的词级帮助。现在需要在不扩大成重型词典应用、不上账户/云历史、**不对 hover 调用 LLM** 的前提下，设计下一轮 Dogfood 可用性迭代。

## What Changes

- 新增 **Local History**：与 Saved 分离的自动本地历史；顶栏入口；优先从左侧打开的 History 抽屉；约 200 条有界存储；跳过连续重复请求；不记录 provider/API 错误；恢复时回填输入与完整语义结果，并用该条历史 **单独** 重新 seed 当前 ephemeral session context。
- **Unified result text blocks**：将 Meaning in this context、Usage / reference、Example、Explanation 重构为同一可复用结果文本块组件（ typography、间距、surface、Listen/Copy、hover/focus、暗色模式一致）；**不**改变 DeepSeek 结构化结果契约。
- **Instant local word lookup**：在上述解释性英文段落内，对词/lexical unit 约 300 ms hover 后显示轻量 tooltip；含词形、当前口音 IPA（本地 `getIPA`）、Listen、以及 **本地/offline 英英词典短释义**（非中文）；**不**新增 `/api/gloss`、**不**调用 DeepSeek；实现前完成轻量词典 engine bake-off 并选定最小可用数据源。
- History **不**持久化 IPA；恢复后由当前本地 IPA 层重新生成。
- 恢复历史 **不**回滚 theme / pronunciation 偏好；**不**恢复不可见的多轮 session 快照。

## Capabilities

### New Capabilities

- `local-interaction-history`：自动记录、浏览、恢复近期成功解析的 SayIt 交互，与 Saved 概念分离。
- `unified-explanatory-result-blocks`：解释性结果区块的 UI 一致性与共享组件行为。
- `instant-local-word-lookup`：解释性段落内的词级 hover/tap、分段、本地 IPA/播放与本地英英词典释义。

### Modified Capabilities

- `session-context`：从历史项恢复时，用所选单条交互重新初始化 ephemeral context，以支持后续 follow-up，而不回放旧的多轮上下文。

## Impact

- 客户端：`App.tsx`、新 history repository、抽屉布局（History 左 / Saved 右）、共享 `ExplanatoryResultBlock`、词级 hover 与 tooltip、`Intl.Segmenter`、`getDefinition` adapter、lazy 词典资源加载与 lemma cache。
- 服务端：**无** 新增 hover/词典 endpoint；`/api/retrieve` 语义不变。
- 存储：新 `sayit.history.v1`；可选 bounded definition lookup cache；Saved 不变。
- 测试：history、definition adapter、segmenter、UI 块一致性；Dogfood 手动 hover “gag” 与 accent 切换。
- **Non-goals**：中文翻译、账户/云历史、hover 用 LLM、Production Hardening、完整词典应用 UI。
