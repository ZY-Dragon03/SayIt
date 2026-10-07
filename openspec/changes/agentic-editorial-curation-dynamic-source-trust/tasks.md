# Tasks

## 1. Product Contract

- [x] 1.1 在 PR #1 后的 main 基线创建独立 V1.1 change，确认旧 V1 契约与证据只读。
- [x] 1.2 PM 定义 V11-F1–F6、10 项增量 PAT 与 17 项已知受影响 V1 回归，关闭最小产品默认行为。
- [x] 1.3 严格校验 OpenSpec；PM 写入冻结 revision 与 artifact identity，见 freeze.md 和 contract-manifest.json。
- [x] 1.4 执行主机提交冻结工件并在 execution.md 记录 Git identity 后开始实现。

## 2. Implementation Plan and Feasibility Gate

- [x] 2.1 实现角色记录当前模型适配、候选上下文/调用限额、严格结构契约、持久化兼容与发现预算方案，优先扩展现有能力；依据受控 Explore 报告记录于 implementation-plan.md。
- [x] 2.2 验证现有提供商可执行有界结构语义调用的已有 JSON/验证入口，验证动态来源客观核验路径可行；记录无新付费服务、无安全绕行。静态实施可行性门见 feasibility.md，实时连通性与语义表现留给最终候选验证。

## 3. Implementation

- [x] 3.1 移除出版者名单的 FULL_TEXT/编辑优先级权威；保留全部客观来源、访问、正文和网络安全检查与理由，以未知合格/不合格来源和既有安全边界测试验证，记录核验信号说明。
- [x] 3.2 使宽泛发现候选具有实际处理机会，固定域名只作为可选提示，以查询/候选来源断言验证并记录生产名单外来源决策。
- [x] 3.3 增加真实版本化语义阶段、严格验证与失败状态；最终选择只使用核验通过且语义批准候选并维持 V1 硬约束，以结构/越权/短缺/错误测试验证，并记录实际契约与调用限额。
- [x] 3.4 持久保存新交付文章的紧凑理由/贡献类型/决定关联，兼容无新字段的 V1 记录；以存取/重启兼容断言验证，并通过可选详情或 trace 提供观察说明。

## 4. Engineering and Integration

- [x] 4.1 汇合各实现任务已提供的回归证据，运行正常工程套件与构建并保存结果；见 artifacts/sayit-reader-v11/engineering/implementer-handoff.md（正常 150/150，聚焦 92/92，typecheck/build PASS）。
- [x] 4.2 Integrator 核对仅本增量改动，旧 V1 证据/PR 不变；初始 candidate 为 `628aa110e59b5f77bcb5bcd4782acf0b1f959970`，PAT-V11-03 有界修复后的当前单一 candidate 为 `a33e7ff1a881551ade59b37e38da24fca05a7dc4`，均已验证 tree/source manifest 与对应工程证据一致。

## 5. Product Acceptance and Delivery

- [ ] 5.1 AE 对最终候选执行 PAT-V11-01–10；包含真实未知来源抓取、真实语义对照和真实宽泛发现运行。
- [ ] 5.2 AE 复用直接证据并完成列明的 17 项受影响 V1 观察；若实现实际扩大观察面，明确补列原案例。
- [ ] 5.3 真实 FAIL 只返回负责的 Implementer 做必要修复；新候选重跑受影响案例及所需回归，AE 不修实现。
- [ ] 5.4 生成候选绑定验收报告和日志索引；PM 在全部必需案例 PASS 后作 V1.1 最终产品判定。
- [ ] 5.5 提交并推送新分支及合规证据，针对 current main 开新 PR，交付 candidate/PR、分组结果、真实运行与未知来源接受/拒绝例证。

当前收口记录（2026-10-07，candidate `a33e7ff1a881551ade59b37e38da24fca05a7dc4`）：独立 AE 报告新 V1.1 8 PASS / 0 FAIL / 2 NOT-RUN，受影响 V1 14 PASS / 0 FAIL / 3 NOT-RUN。报告和索引已生成，尚未满足最终产品接受条件；待补观察仅为 PAT-V11-01、PAT-V11-06、PAT-RC-07、PAT-RH-09、PAT-RH-12。实时发现尚无未知出版者核验成功正例，CUA bridge 失败还阻塞两项真实 UI 观察。PM 状态为 ACCEPTANCE_INCOMPLETE。

任务勾选属于执行记录，可随进度更新；冻结产品意义由 `freeze.md` 所列合同工件及 revision 决定，不能通过任务改写降低验收要求。
