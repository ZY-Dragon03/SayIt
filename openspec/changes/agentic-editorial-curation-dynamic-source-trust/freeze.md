# Product Contract Freeze

## Decision

**PRODUCT_CONTRACT_FROZEN — sayit-reader-v1.1-product-contract-r1**

- PM：当前 native PIW PM thread `/root/piw_pm_v11`；执行主机 `/root`。
- 冻结时间：2026-10-06 04:07:30 UTC。
- 授权：Product Owner 的 SayIt Reader V1.1 完整请求已明确授权 PM 冻结增量、实施、集成和验收，普通技术决定不需再次授权。
- main 基线：`d80e13c327ac2a8672e0eee95584cb4333dd422b`，PR #1 后。
- 实施分支：`feature/sayit-reader-v11-agentic-editorial`。
- 冻结合同集合 SHA-256：`5d58710e6fd10df211f69db4cbcd91f035a0a71a874d918aa013861f2769692d`。
- 逐文件身份见 `contract-manifest.json`：proposal、design、acceptance-plan 和两份 capability spec。

PM 依据 Product Owner 授权，裁决本增量产品语义已闭合、可开始后续实施计划/可行性门与受控实现。此标记只冻结产品契约，**不代表 PRODUCT_ACCEPTED**。最终接受必须有同一集成候选的 10 项新 PAT 和受影响 V1 回归全 PASS 证据。

冻结 SHA 对所列文件原始 UTF-8 字节计算；集合输入为按 path 排序的 `path<TAB>lowercase-sha256<LF>`。执行主机在应用代码开始前提交本工件集，把完整 Git commit identity 记录到 `execution.md`；该记录不需要反向改动本冻结文件。任务勾选、实施计划、当前状态及执行/验收证据不属于冻结语义集合，可推进，但不得修改合同含义。

## Closed Product Decisions

1. 未知出版者按相同客观文章规则核验；名字/域名名单不能控制全文或编辑资格。
2. 宽泛结果有正常处理机会；固定域名提示仅补充，真实验收必须触达未预列出版者。
3. 真实 Agent 承担主题适配与内容编辑判断；确定性规则保有所有安全、来源、全文、去重、度量和履约权威。
4. 版本化结构决定严格校验；模型仅引用已核验候选 ID，不能写入来源事实或提升访问/全文资格。
5. 默认复用已配置模型，无新增付费服务；语义失败如实记录，V1.1 没有自动确定性降级。
6. 同事件独立观点可并列；不实施政治可信度评分或意识形态过滤。
7. 新文章理由与贡献类型可通过可选详情/trace 查阅并在重启后保留；V1 数据缺少新字段合法。
8. V1 的调度、单日 Issue、合并/Regenerate、归档进度、Inline SayIt、主工作区隔离和来源归属继续有效；旧证据不改写。

## Acceptance Identity

- 必需功能：V11-F1–F6。
- 新 PAT：PAT-V11-01–10，共 10 项。
- 已知受影响 V1 PAT：PAT-RC-07–16、18、26–28；PAT-RH-09、12、15，共 17 项。
- V1 历史合同总数仍为 49；本次只为受影响观察新增回归证据。具体实施若扩大观察面，在本轮报告加入相应旧案例，保留原含义。
- PM 没有应用代码实现权限；AE 没有修复实现权限。产品含义变化只能回到 PM 处理，不得通过实现或验收记录静默放宽。

## Validation

`openspec validate agentic-editorial-curation-dynamic-source-trust --strict`：exit 0，`Change 'agentic-editorial-curation-dynamic-source-trust' is valid`。

按要求尝试 `openspec validate --strict`：非交互 CLI 返回 exit 1，`Nothing to validate`，要求指定对象或 `--all`。随即执行 `openspec validate --all --strict`：exit 0，`Totals: 8 passed, 0 failed (8 items)`。三个既有变更存在 archive 目标不存在的 INFO，不是本增量错误，也未修改它们。

当前没有必须由 Product Owner 裁决的产品冲突。进入实现后如出现不可避免的新付费承诺或实质可行性阻塞，按原授权边界上报。
