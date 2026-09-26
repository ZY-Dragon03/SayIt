## 1. Pronunciation controls UI

- [ ] 1.1 将 `PronunciationControls` 中两个 `<select>` 改为单按钮 toggle（US↔UK、1×↔0.8×），复用现有 `onChange` / `savePronunciationPreferences` 路径；移除仅用于下拉的 `ChevronDownIcon`
- [ ] 1.2 为两个 toggle 添加/更新 `aria-label`（含当前值与 switch 语义）并验证 Enter/Space 可切换

## 2. Styles

- [ ] 2.1 在 `App.css` 中为 `.preference-toggle`（或等价）对齐顶栏按钮 hover/focus/dark mode；删除或收敛仅服务于 select 的样式

## 3. Verification

- [ ] 3.1 运行 `npm run typecheck` 与 `npm test` 并确认通过
- [ ] 3.2 Dogfood 手动：单击 US→UK、1×→0.8×，刷新页面偏好仍正确；Listen 与 IPA accent 随 US/UK 变化
