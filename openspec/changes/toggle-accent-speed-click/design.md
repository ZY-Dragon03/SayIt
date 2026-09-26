## Context

SayIt 顶栏 `PronunciationControls`（`App.tsx`）使用两个 `<select>`：`us`/`uk` 与 `normal`/`slow`（UI 标签 `1×` / `0.8×`）。偏好经 `loadPronunciationPreferences` / `savePronunciationPreferences` 写入 `sayit.pronunciation.v1`；`PronunciationService.speak` 使用 `en-US`/`en-GB` 与 rate `1`/`0.8`。动机见 `proposal.md`。

## Goals / Non-Goals

**Goals:**

- 单次点击完成 US↔UK、1×↔0.8× 切换。
- 控件 **显示当前状态**（非隐藏选中项的下拉）。
- 与现有 theme/history 顶栏控件在尺寸与 focus/hover 上协调。
- 保持 `aria-pressed` 或等效说明「当前值，点击切换」。

**Non-Goals:**

- 增加第三种口音或第三种语速。
- 修改 IPA lookup accent 逻辑（仍绑定 `preferences.accent`）。
- 重做 `PronunciationService` 或 voice 选择算法。

## Decisions

### 1. 控件形态：成对 toggle button，非 `<select>`

每个设置一项 **单个 `<button type="button">`**，文案为当前选项：

| 维度 | 显示 | 点击后 |
| --- | --- | --- |
| accent | `US` 或 `UK` | 切换到另一 accent |
| speed | `1×` 或 `0.8×` | 切换到另一 speed |

`onChange` 仍通过现有 `onChange(preferences)` 回调更新 state 并 `savePronunciationPreferences`（父组件已有逻辑则复用）。

**备选**：两个并排 pill（US | UK）高亮当前项 — 占用更宽；本 change 采用 **单按钮切换** 以贴近用户「点 US 切到 UK」描述。

### 2. 可访问性

- `aria-label`：`Pronunciation accent, currently US, click to switch to UK`（随状态更新；语速同理）。
- 可选 `aria-pressed="true"` 表示「当前激活选项」；或仅用 label 描述当前值。
- 键盘：button 默认可 Tab 聚焦；Enter/Space 触发切换。
- 移除 `<label><select>` 与 `ChevronDownIcon`。

### 3. 样式

- 复用顶栏 `.theme-toggle` / History 按钮的 border、hover、focus-visible 模式（见 `App.css`），类名如 `.preference-toggle`。
- 保留 `.control-divider` 分隔两个按钮。
- 删除仅服务于下拉的 `.preference-select` 与 select 箭头样式（若无其他引用）。

### 4. 测试

- 若有 `pronunciation.test.ts` 仅测 storage/service，**不必**改断言。
- 可选：轻量 React 测试或保留 Dogfood 手动：点击 US→UK、1×→0.8×，刷新后偏好仍在。

## Risks / Trade-offs

| Risk | Mitigation |
| --- | --- |
| 用户不知可点击切换 | 按钮样式与顶栏一致 + aria-label 说明 switch |
| 触屏误触 | 与现有 select 相当；无额外手势 |
| 样式回归 dark mode | 手动或截图对比 light/dark 顶栏 |

## Migration Plan

1. 替换 `PronunciationControls` markup。
2. 调整 CSS；移除未使用的 ChevronDownIcon import（若仅用于此处）。
3. `npm run typecheck` / `npm test` / 快速顶栏点击验证。
4. 无数据迁移；旧 localStorage JSON 完全兼容。
