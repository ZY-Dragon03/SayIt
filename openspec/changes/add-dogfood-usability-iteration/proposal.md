## Why

Dogfood 使用一段时间后，SayIt 在「找回刚才的结果」「阅读解释性英文时查词发音」以及「结果区块视觉一致性」上仍明显不足：Saved 只适合长期收藏，无法自动回顾近期交互；Meaning / Usage / Example / Explanation 的样式与交互不统一；解释性段落里的生词缺少轻量、保持英语沉浸的语境提示。现在需要在不扩大成词典应用、不上账户/云历史的前提下，设计下一轮 Dogfood 可用性迭代。

## What Changes

- 新增 **Local History**：与 Saved 分离的自动本地历史；顶栏入口；优先从左侧打开的 History 抽屉；约 200 条有界存储；跳过连续重复请求；不记录 provider/API 错误；恢复时回填输入与完整语义结果，并用该条历史 **单独** 重新 seed 当前 ephemeral session context。
- **Unified result text blocks**：将 Meaning in this context、Usage / reference、Example、Explanation 重构为同一可复用结果文本块组件（ typography、间距、surface、Listen/Copy、hover/focus、暗色模式一致）；**不**改变 DeepSeek 结构化结果契约。
- **Contextual word hover**：在上述解释性英文段落内，对词/lexical unit 约 300 ms hover 后显示轻量 tooltip；含词形、当前口音 IPA（本地 `getIPA`）、Listen、以及 lazy 加载的 **contextual gloss**（短英文语境释义，非中文翻译）；新增小型 `POST /api/gloss`；gloss 按词 + 语境缓存；IPA 与 playback 仍走现有本地层。
- History **不**持久化 IPA；恢复后由当前本地 IPA 层重新生成。
- 恢复历史 **不**回滚 theme / pronunciation 偏好；**不**恢复不可见的多轮 session 快照。

## Capabilities

### New Capabilities

- `local-interaction-history`：自动记录、浏览、恢复近期成功解析的 SayIt 交互，与 Saved 概念分离。
- `unified-explanatory-result-blocks`：解释性结果区块的 UI 一致性与共享组件行为。
- `contextual-word-gloss`：解释性段落内的词级 hover/tap、分段、本地 IPA/播放与 lazy contextual gloss API。

### Modified Capabilities

- `session-context`：从历史项恢复时，用所选单条交互重新初始化 ephemeral context，以支持后续 follow-up，而不回放旧的多轮上下文。

## Impact

- 客户端：`App.tsx`、新 history repository、抽屉布局（History 左 / Saved 右）、共享 `ExplanatoryResultBlock`、词级 hover 与 tooltip 层、`Intl.Segmenter` 集成。
- 服务端：新增 `/api/gloss` proxy（DeepSeek 非 thinking、小 token）；**不**扩展 `/api/retrieve` 返回全词表。
- 存储：新 `localStorage` envelope（如 `sayit.history.v1`）；gloss 客户端 cache；Saved 存储键与语义不变。
- 测试：history dedupe/restore/context seed、gloss contract/cache、UI 块一致性；Dogfood 手动验收 History 与 hover gloss。
- **Non-goals**：中文翻译、账户/云历史、新 IPA 引擎、Production Hardening、把 SayIt 做成词典应用。
