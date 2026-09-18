## 1. 共享契约与 session context

- [x] 1.1 扩展共享结果契约，保留 retrieve 的现有字段和旧快照兼容，并增加严格的 `retrieve`/`interpret` union、interpretation payload、受控语义类别和稳定状态；通过 Zod 合法/非法 fixture 测试验证
- [x] 1.2 增加最多 3 轮 session context 的请求 schema、字段长度和摘要边界；通过缺失 context、合法 context、超长 context、未知字段和超出轮数测试验证
- [x] 1.3 更新 dogfood fixtures，加入 `road house` interpretation、Peter correction、无语境澄清和 retrieve 回归案例；通过 fixture 清单测试验证

## 2. Provider、API 与安全诊断

- [x] 2.1 更新 provider abstraction 和 `/api/retrieve`，接收并校验 ephemeral context，确保服务端不持久化 context 且当前输入优先；通过 API mock 测试验证 context 只被传给 provider
- [x] 2.2 更新结构化 prompt，实现自动 retrieve/interpret 路由、文化引用解释、短 context 使用和 prompt injection 隔离；通过 provider request body 和 mode fixture 测试验证
- [x] 2.3 在 DeepSeek 请求中显式加入 `thinking: { type: "disabled" }`，保留 `deepseek-flash`、JSON Output、Zod validation 和一次 repair；通过 request body 测试验证
- [x] 2.4 增加仅在本地 Dogfood 开发模式启用的安全诊断，区分 `empty_content`、`malformed_json` 和 `schema_invalid`，记录 Zod issue path/code，不记录 key、完整输入或完整输出；通过诊断 mock 测试验证
- [x] 2.5 保持 repair 失败为可重试的稳定 provider error，并提供有用错误文案；通过空输出、malformed JSON、schema-invalid、repair 成功和 repair 失败测试验证

## 3. 单页 UX 与 ephemeral session

- [ ] 3.1 在 React 页面内维护最多 3 轮内存 session context，成功结果生成有限摘要并随下一次请求发送；通过连续提交、上限裁剪和刷新清空的行为测试验证，不写入 localStorage
- [ ] 3.2 保持现有 retrieve renderer，增加 interpretation renderer，显示 Expression、Meaning in this context、Usage / reference 和可选 Example；通过 mode fixture 和手动键盘流程验证不出现模式选择器或聊天历史
- [ ] 3.3 为 interpretation 结果增加字段复制与 refinement 入口，保留输入、Retry 和错误状态；通过手动验证 `road house` -> correction 流程和非法输出恢复
- [x] 3.4 确认 localStorage 仍只保存显式 retrieve 表达，旧保存快照可读，session context 不进入保存项；通过 storage 回归测试验证

## 4. Dogfood 验证

- [x] 4.1 运行 typecheck、Vitest 全量测试和 production build，确认旧 retrieve、interpret、context、诊断和 thinking-disabled 测试全部通过
- [x] 4.2 在本地开发模式用 Road House、Peter correction、known idiom/slang、正常 retrieve 和无语境表达进行 mock-provider smoke test；记录 mode、结构化摘要、诊断类别和延迟，不记录敏感原文
- [ ] 4.3 在配置真实 DeepSeek key 的受控本地环境执行一次 retrieve 与一次 correction/interpret smoke test；确认 JSON Output、非 thinking、上下文引用和完整 UI 链路可用
- [ ] 4.4 评审 Dogfood 退出条件，确认该扩展仍不引入模式选择、聊天、web search、RAG、数据库或 Production Hardening
