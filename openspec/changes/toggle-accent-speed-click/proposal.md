## Why

顶栏发音设置目前使用两个 `<select>` 下拉框切换 US/UK 与 1×/0.8×，在 Dogfood 顶栏里操作步骤偏多、视觉上也与 History/Saved 等轻量按钮不一致。改为 **点击当前值即可在两种选项间切换**，可更快切换口音与语速，并减少误触展开菜单。

## What Changes

- 将 **口音** 控件从下拉框改为 **toggle button**：显示当前值（`US` 或 `UK`），单击在 US ↔ UK 间切换。
- 将 **语速** 控件从下拉框改为 **toggle button**：显示当前值（`1×` 或 `0.8×`），单击在 normal ↔ slow 间切换。
- **不**改变 `PronunciationPreferences` 数据模型、`sayit.pronunciation.v1` 存储键、默认值（US + normal）、Web Speech locale/rate 映射或 Listen 播放语义。
- 移除口音/语速控件上的下拉 chevron 视觉；保留可访问性标签（当前口音/语速 + 切换语义）。

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `pronunciation-playback`：口音与语速偏好 **交互方式** 从下拉选择改为点击切换；持久化与播放行为不变。

## Impact

- 客户端：`App.tsx` 中 `PronunciationControls`；`App.css` 中 `.pronunciation-controls` / `.preference-select` 样式（改为 button toggle 或复用顶栏 chip 风格）。
- 测试：若有 pronunciation preference 相关测试，补充 toggle 行为；手动确认 localStorage 仍正确读写。
- 服务端与 API：**无**变更。
