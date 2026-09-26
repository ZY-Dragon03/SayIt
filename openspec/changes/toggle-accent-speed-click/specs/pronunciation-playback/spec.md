## MODIFIED Requirements

### Requirement: Accent and speed preferences

系统 SHALL 支持 US (`en-US`) 和 UK (`en-GB`) 两种口音，以及 Normal (`1.0`) 和 Slow (`0.8`) 两种速度；默认值 SHALL 是 US 和 Normal。用户选择 SHALL 在当前浏览器本地保存，并在后续页面会话中恢复。

顶栏 MUST 以 **点击切换** 方式调整口音与语速：每个设置一项控件显示 **当前** 选项（口音显示 `US` 或 `UK`；语速显示 `1×` 或 `0.8×`），用户单击该控件 MUST 在对应的两种合法值之间切换。MUST NOT 使用下拉框（`<select>`）作为口音或语速的首选交互。

#### Scenario: Use default pronunciation preferences

- **WHEN** 浏览器中没有有效的 pronunciation preference
- **THEN** 系统使用 US locale 和 `1.0` rate，且顶栏控件显示 US 与 1×

#### Scenario: Persist selected preferences

- **WHEN** 用户通过点击将口音或语速切换到非默认值（例如 UK 或 Slow）
- **THEN** 系统立即使用新选择，并在下次页面会话恢复该选择

#### Scenario: Toggle accent with one click

- **WHEN** 当前口音为 US 且用户单击口音控件
- **THEN** 口音变为 UK，控件显示 UK，后续 Listen 使用 UK locale

#### Scenario: Toggle speed with one click

- **WHEN** 当前语速为 Normal（1×）且用户单击语速控件
- **THEN** 语速变为 Slow（0.8×），控件显示 0.8×，后续 Listen 使用 0.8 rate

#### Scenario: Ignore invalid preference values

- **WHEN** 本地保存的 pronunciation preference 缺少字段或包含不支持的 accent/speed
- **THEN** 系统丢弃无效值并回退到对应默认值，不阻塞结果使用
