# Integration and Acceptance Handoff

## Fixed Scope

产品 revision `sayit-reader-v1.1-product-contract-r1`、冻结 commit `df8b3f53ff1d019034e1c59f82ca8af008649757`、10 项新 PAT 与 17 项已知受影响 V1 案例含义均未变化。PM 不实现应用代码；原 Implementer 线程已完成工程工作并保留为必要修复的唯一首选线程。

## Implementation Evidence

- 代码基线 HEAD：`08a9e62f79ae832d917545cb5d7e29e8d45819e8`；实现改动尚未 commit/stage。
- 新语义契约：`reader-editorial-curation.v1`；实际有界调用、输入与正文表示限额见 `artifacts/sayit-reader-v11/engineering/implementer-handoff.md`。
- 正常测试：22 files / 150 tests PASS。
- 聚焦测试：9 files / 92 tests PASS，包含 provider、semantic、editorial/provenance、service failure/context、store restart/legacy、API persistence、safe-fetch 和共享契约。
- typecheck、build、diff check：PASS。
- PM 将 handoff 中 14 个 source/test `git hash-object` 值与当前工作树逐一核对，全部匹配。Integrator 固定提交后应再次以 commit blob 核对，可沿用相同实现树的工程证据；发生代码变化时只重跑受影响检查及所需回归。
- 冻结工件 hash 全部匹配；旧 V1 文档/证据、safe-fetch 实现、Reader UI、package manifests/lockfile 没有改动。

## Integrator Next Action

执行主机只做有界 source review、工件一致性检查和确立单一 candidate SHA。真实缺陷返回实施线程做必要修复；不得在集成过程中顺手改造其他模块。提交时使用准确路径，包含新 V1.1 工程/状态证据；不触碰旧证据分支或 PR #1。集成候选确定后把 SHA、tree 和 evidence 索引交回 PM。

## AE Handoff Boundary

PM 将在 candidate 固定后另建独立 AE native 子线程。AE 只拥有新验收脚本、运行记录和报告；不能修产品实现。全部观察按照冻结 acceptance-plan，允许复用直接证据，禁止把工程测试总数直接标成 PAT PASS。

特别注意以下尚未证明的观察：

1. PAT-V11-01 的真实未知出版者文章抓取/资格/入选路径。现有 Infostream 单元正例使用生成内容和受控 fetch/semantic client，不能替代实际文章证据。
2. PAT-V11-03 的真实 provider 对照选择，以及 PAT-V11-06 的无完整 URL 输入、真实宽泛搜索且触达列表外出版者的运行。均尚未执行。
3. PAT-V11-02：现有 known/unknown 参数化回归证明 canonical mismatch、missing publisher identity 和 title metadata conflict 会不交付全文、保存具体原因且不调用模型；未知摘要候选也有工程证据。但 frozen case 的 publisher 与 og:site_name 明确冲突子观察还应由 AE 对固定候选运行最小补充 fixture，要求 `Publisher identity metadata conflicts.`、无 FULL_TEXT/篇数贡献且无语义覆盖。不得以“域名未知”作为拒绝证据。
4. 来源核验当前证明的是页面/来源证据一致性，不是全球出版品牌所有权认证。不能以品牌字符串和 hostname 文本相等作为新增许可名单规则；可观察身份、canonical、正文冲突仍须拒绝。AE 如发现实际冻结行为失败，记录明确输入/输出并返回原 Implementer，不修改契约来迁就实现。
5. 新交付理由重启后可检索、实际 Reader 全文与外链观察，以及列明受影响 V1 进度/Regenerate 等产品观察需要逐项裁决；工程直接证据可支持相同观察。

当前正式产品结果仍为：新 V1.1 0 PASS / 0 FAIL / 10 NOT-RUN；本轮受影响 V1 0 PASS / 0 FAIL / 17 NOT-RUN。V1 原历史接受状态保持有效。
