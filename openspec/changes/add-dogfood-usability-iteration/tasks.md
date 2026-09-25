## 0. Dictionary engine decision gate

- [x] 0.1 对比 `dictionary-en`、`wordnet`、`en-dictionary`/`en-wordnet` 与 generated compact lexicon 方案，记录体积、延迟、释义质量、浏览器可行性与 license
- [x] 0.2 实现 `scripts/generate-sayit-lexicon`（或等价）+ `sayit-lexicon.manifest.json`：锁定频率源 URL/checksum/license、WordNet 版本、entryCount、实测 gzip/sha256；**生成至少一次 artifact 并记录 golden + 词形 fallback 覆盖率**
- [x] 0.3 评审并批准词典来源：compact lexicon **仅能在 0.2 实测通过后** 批准；否则 fallback `wordnet@2.0.0` lazy chunk；未批准前不得实现 hover 释义

## 1. Local History

- [x] 1.1 定义 `sayit.history.v1` envelope、`HistoryRecord` Zod schema（含完整 `SayItResult`、无 IPA），并实现 `LocalHistoryRepository`（append/list/restore helpers、200 上限、损坏 envelope 容错）
- [x] 1.2 在成功 `status === "success"` 的 `/api/retrieve` 完成后写入 History；实现 consecutive dedupe；确认 error/provider 失败不写入
- [x] 1.3 顶栏 History 入口 + 左侧 drawer UI；与右侧 Saved drawer 互斥；列表展示 mode/标题/时间
- [x] 1.4 点击 History 项：恢复 input/result、清除 activeSavedId、**单条** seed session context、关闭 drawer、触发本地 IPA lookup；验证 theme/pronunciation 不变
- [ ] 1.5 为 dedupe、cap、restore+context seed 增加单元测试；Dogfood 手动：interpret 恢复后 follow-up

## 2. Unified explanatory result blocks

- [x] 2.1 抽取 `ExplanatoryResultBlock`（kicker、正文、ContextualActions、shared classes）
- [x] 2.2 替换 Meaning、Usage/reference、Example、Explanation 四处渲染；删除 Example/Explanation 样式分叉
- [ ] 2.3 验证 dark mode、hover/focus actions、touch 可发现性与重构前一致或更好；确认 `SayItResult` schema 无变更

## 3. Instant local word lookup

- [x] 3.1 实现 `segmentExplanatoryText()`：`Intl.Segmenter` + contraction/hyphen 后处理；特性不支持时 graceful disable
- [x] 3.2 实现 `resolveLemma(surface)`：exact normalize 后查表 + 确定性 morphology/irregular fallback（**无 LLM**）；单测：`granted`, `uses`, `referencing`, `kicked`, `children`
- [x] 3.3 实现 300 ms pointer hover / touch tap tooltip（word、IPA via `getIPA`、Listen）；**无** per-word keyboard tab stop；解释块 mount 时 idle prefetch 词典 chunk
- [x] 3.4 在词典 gate 通过后实现 `getDefinition(resolvedLemma)`：sense 选择 + metadata trim + `;` 分句 + 长度上限（**保留词典措辞，不 paraphrase**）；bounded lemma cache
- [ ] 3.5 集成到四个解释性区块；hover **无** DeepSeek/外部 API；词典未 load 时仍 word/IPA/Listen；Dogfood 手动 “gag” + 词形用例 + accent 切换

## 4. Session context delta

- [x] 4.1 实现 History restore 的 single-turn context replace；确认 Saved load 行为不变
- [x] 4.2 更新 session-context 相关测试/fixtures

## 5. Verification（评审通过后执行）

- [x] 5.1 `npm run typecheck`、`npm test`、`npm run build`
- [ ] 5.2 Dogfood checklist：History vs Saved、左/右 drawer、Road House 恢复+follow-up、解释块视觉一致、hover 无 DeepSeek/外部 API、无中文释义、pointer/touch lookup（非逐词 Tab）

**Stop gate:** 词典 **artifact 实测** 与 OpenSpec 评审通过前 **不得** 开始 `/opsx-apply` 实现。
