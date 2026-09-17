## 1. Milestone 1 — Dogfood MVP：最小基础

- [ ] 1.1 初始化 React、TypeScript、Vite 和最小测试工具链，并保持前端与 API 的类型边界清晰；通过开发构建和类型检查命令验证
- [ ] 1.2 选择本地运行或私有部署作为首次使用路径，配置服务端 DeepSeek secret 和最短启动命令；通过环境变量审查确认 key 未进入客户端 bundle
- [ ] 1.3 建立版本化检索结果 schema、表达类型枚举、状态枚举和 API 错误形状；通过合法/非法 fixture 的运行时校验测试验证
- [ ] 1.4 建立最小输入、噪声、成功、澄清、无匹配和错误 fixture 集；通过 fixture 清单覆盖两份 capability spec 的核心场景验证

## 2. Milestone 1 — Dogfood MVP：最小模型与 API 链路

- [ ] 2.1 实现不暴露给客户端的 `ExpressionProvider` 接口和 DeepSeek adapter，隔离鉴权、模型名、参数、上游响应和错误格式；通过 mock provider contract test 验证
- [ ] 2.2 编写 `sayit.expression-retrieval.v1` 系统 prompt，覆盖意图推断、噪声分离、自然表达优先、英文-only、候选上限和输入隔离；通过代表性 fixture smoke test 验证
- [ ] 2.3 实现最小同源 `POST /api/retrieve` proxy，包含空值/500 字符/请求体校验、上游调用、基础超时和稳定错误映射；通过 400、成功、超时和网络失败测试验证
- [ ] 2.4 实现模型响应解析、结果 schema 校验、字段长度/枚举约束和最多一次受限修复请求；通过非法 JSON、错误枚举和修复失败测试验证半成品不会进入客户端

## 3. Milestone 1 — Dogfood MVP：个人使用界面

- [ ] 3.1 实现单页输入 surface，包含自动聚焦、多行编辑、500 字符限制、空值提示、Enter 提交和 Shift+Enter 换行；通过键盘流程验证 composition 状态不会误提交
- [ ] 3.2 实现 `idle`、`editing`、`submitting`、成功、澄清、无匹配和基础服务错误状态；通过状态测试验证重复提交被阻止、输入保留且 Retry 可用
- [ ] 3.3 实现固定层级结果 renderer：Best match、Useful expressions、Natural version 和条件性 Explanation；通过契约 fixture 验证最多 3 个替代项、空解释不占位、中文不自动渲染
- [ ] 3.4 实现表达、替代项和自然句的 Copy 操作及基础成功反馈；通过剪贴板 mock 和手动键盘流程验证复制内容准确
- [ ] 3.5 实现版本化 `MemoryRepository`，使用命名空间 localStorage 保存显式快照并处理基本读写失败；通过保存、浏览器重载、删除和配额失败测试验证
- [ ] 3.6 实现基础清晰样式、焦点状态、保存入口、深浅色可用主题和保存项查看区域；通过个人桌面浏览器手动检查验证主循环无需额外导航即可完成

## 4. Milestone 1 — Dogfood MVP：验证与发布

- [ ] 4.1 使用 mock provider 完成核心 API smoke test，覆盖成功、澄清、无匹配、非法模型响应和基础错误；通过本地测试确认不依赖真实 DeepSeek
- [ ] 4.2 在受控环境运行一次真实 DeepSeek model smoke test，仅记录 fixture id/输入类别、结构化结果摘要、延迟和失败原因，不记录敏感原文；通过人工检查确认完整链路可用
- [ ] 4.3 部署到本地或私有环境并验证同源请求、服务端 secret、复制、localStorage 保存和错误重试；通过一次从冷启动到连续两次检索的手动验收验证
- [ ] 4.4 使用真实个人工作输入连续试用，并记录明显错误、缺失表达、延迟和保存问题；通过 Dogfood checklist 确认“输入 -> 结果 -> Copy/Save -> 下一次输入”可重复完成
- [ ] 4.5 评审 Dogfood 退出条件，确认个人可以每天使用而不需要公开 rate limit、正式观测、完整 E2E 或生产回滚；通过一份里程碑验收记录决定是否进入 Production Hardening

## 5. Milestone 2 — Production Hardening：公开部署保护

- [ ] 5.1 在不改变 `/api/retrieve` 和 provider abstraction 的前提下配置正式静态前端与无状态 API 部署；通过预发布健康检查和 API smoke test 验证
- [ ] 5.2 增加 rate limiting、abuse protection、请求成本上限、配额策略和告警；通过限流、超额和故障演练验证公开端点不会无限消耗模型费用
- [ ] 5.3 增加 CSP、CORS、HTTPS、安全响应头、严格请求边界和 secret/bundle 扫描；通过安全测试和静态产物审查验证
- [ ] 5.4 增加只包含 request id、延迟、状态、错误类别和成本汇总的非敏感 observability；通过日志审查验证原始输入、完整模型响应和 key 不被记录

## 6. Milestone 2 — Production Hardening：完整质量验证

- [ ] 6.1 为输入边界、噪声分类、结果 schema、错误映射和 localStorage 迁移补齐单元测试；通过 Vitest 全量运行验证
- [ ] 6.2 为 API 补齐集成测试，覆盖成功、澄清、无匹配、非法输出、超时、限流和成本保护；通过 CI mock provider 测试验证
- [ ] 6.3 编写 Playwright E2E，覆盖“聚焦 -> 输入 -> Enter -> 结果 -> Copy/Save -> 下一次输入”、错误恢复、深色模式、窄屏和离线保存；通过 CI 浏览器测试验证
- [ ] 6.4 完成 axe/人工可访问性、焦点、live region、对比度、reduced-motion、响应式和触控验收；通过多视口与辅助技术检查验证
- [ ] 6.5 建立真实模型评测集和正式质量门槛，记录结构化有效率、意图命中率、噪声不突出率、自然句可用率、无中文泄漏率和 p50/p95 延迟；通过人工抽样和门槛记录决定公开发布
- [ ] 6.6 完成性能预算和安全回归检查，确认没有重型 UI、分析 SDK、prompt injection 泄漏或未经授权的数据上传；通过构建产物扫描和回归测试验证

## 7. Milestone 2 — Production Hardening：兼容、回滚与后续

- [ ] 7.1 记录 provider、prompt、结果 schema 和 localStorage 版本兼容策略；通过一次模拟升级/回滚验证旧客户端和保存快照仍可读
- [ ] 7.2 建立静态资源原子发布、API 配置回滚、模型质量回退和 localStorage 迁移失败处理流程；通过故障演练验证本地保存项不会被删除
- [ ] 7.3 在 Dogfood 使用数据和反馈基础上复查浏览器扩展、PWA、全局快捷键、账户同步和 spaced repetition；通过独立 OpenSpec 变更评审决定是否进入后续工作
