## 0. Dictionary engine decision gate

- [x] 0.1 对比 `dictionary-en`、`wordnet`、`en-dictionary`/`en-wordnet` 与 generated compact lexicon 方案，记录体积、延迟、释义质量、浏览器可行性与 license
- [ ] 0.2 评审并批准词典来源：首选 generated `sayit-lexicon.v1.json`，或 fallback `wordnet@2.0.0` lazy chunk；未批准前不得实现 hover 释义

## 1. Local History

- [ ] 1.1 定义 `sayit.history.v1` envelope、`HistoryRecord` Zod schema（含完整 `SayItResult`、无 IPA），并实现 `LocalHistoryRepository`（append/list/restore helpers、200 上限、损坏 envelope 容错）
- [ ] 1.2 在成功 `status === "success"` 的 `/api/retrieve` 完成后写入 History；实现 consecutive dedupe；确认 error/provider 失败不写入
- [ ] 1.3 顶栏 History 入口 + 左侧 drawer UI；与右侧 Saved drawer 互斥；列表展示 mode/标题/时间
- [ ] 1.4 点击 History 项：恢复 input/result、清除 activeSavedId、**单条** seed session context、关闭 drawer、触发本地 IPA lookup；验证 theme/pronunciation 不变
- [ ] 1.5 为 dedupe、cap、restore+context seed 增加单元测试；Dogfood 手动：interpret 恢复后 follow-up

## 2. Unified explanatory result blocks

- [ ] 2.1 抽取 `ExplanatoryResultBlock`（kicker、正文、ContextualActions、shared classes）
- [ ] 2.2 替换 Meaning、Usage/reference、Example、Explanation 四处渲染；删除 Example/Explanation 样式分叉
- [ ] 2.3 验证 dark mode、hover/focus actions、touch 可发现性与重构前一致或更好；确认 `SayItResult` schema 无变更

## 3. Instant local word lookup

- [ ] 3.1 实现 `segmentExplanatoryText()`：`Intl.Segmenter` + contraction/hyphen 后处理；特性不支持时 graceful disable
- [ ] 3.2 实现 300 ms hover/tap tooltip（word、IPA via `getIPA`、Listen）；无 tab stop per word
- [ ] 3.3 在词典 gate 通过后实现 `getDefinition(lemma)` adapter + gloss 裁剪（primary + optional secondary）；bounded lemma cache
- [ ] 3.4 集成到四个解释性区块；确认 hover **无** `/api/gloss`、无 DeepSeek；Dogfood 手动 hover “gag” 与 accent 切换

## 4. Session context delta

- [ ] 4.1 实现 History restore 的 single-turn context replace；确认 Saved load 行为不变
- [ ] 4.2 更新 session-context 相关测试/fixtures

## 5. Verification（评审通过后执行）

- [ ] 5.1 `npm run typecheck`、`npm test`、`npm run build`
- [ ] 5.2 Dogfood checklist：History vs Saved、左/右 drawer、Road House 恢复+follow-up、解释块视觉一致、hover 无网络、无中文释义

**Stop gate:** 词典来源与 OpenSpec 评审通过前 **不得** 开始 `/opsx-apply` 实现。
