## Context

当前代码把 IPA 放在 `best_match`、alternative 和 interpretation expression 的 DeepSeek 输出中，并用 Zod 形态校验它。该数据只是可选 UI 元数据，却和 semantic result 的严格解析绑定。本 change 只替换 IPA 的来源；现有 Web Speech API 仍负责把原始英文文本播放出来。

## Goals / Non-Goals

**Goals:**

- 让 DeepSeek 只负责 retrieve/interpret 语义结果，且语义结果不包含 pronunciation metadata。
- 在浏览器本地提供 `getIPA(text, accent): Promise<string | null>`，支持 `us` 和 `uk`。
- 使用离线 deterministic dictionary/G2P engine，首次按需加载，失败时安全返回 `null`。
- 让 accent selector 同时驱动本地 IPA lookup 和现有 Web Speech voice，不触发新的 DeepSeek 请求。
- 按规范化表达和 accent 缓存成功结果，复用重复 lookup。
- 保留当前 IPA 视觉层级、播放速度、播放竞态处理、Copy/Listen actions 和语义结果可靠性。

**Non-Goals:**

- 不新增 DeepSeek 字段、LLM prompt 指令、AI model、云端 phonemizer 或 `/api/pronounce` endpoint。
- 不让 Web Speech API 接收 IPA；它继续播放原始英文表达。
- 不为 Meaning、Usage/reference、Explanation、Example sentence 或 UI labels 生成 IPA。
- 不在 Dogfood 阶段追求词典覆盖率、专业发音词典编辑能力或 Production Hardening。

## Decisions

### 1. 明确三层职责

数据流保持单向且不互相兜底：

```text
DeepSeek
  └─ semantic SayItResult（无 pronunciation）
       └─ expression text
            └─ local getIPA(text, accent)
                 └─ IPA UI（可选）

expression text ──> browser SpeechSynthesis（音频）
```

- DeepSeek 只返回 retrieve/interpret 需要的语义字段。
- Local pronunciation service 只接受英文文本和 `us`/`uk`，不读 session context、不访问网络、不修改 semantic result。
- Web Speech playback 继续使用原始表达文本、现有 voice matching、Normal/Slow rate 和 cancel-before-speak。

### 2. Engine decision gate：先 bake-off，再固定依赖

在实现前比较两个候选：

| 维度 | `phonemizer@1.2.1` | `phonemize@2.0.1` |
| --- | --- | --- |
| 核心方式 | eSpeak NG 编译产物，浏览器 WASM | MIT 纯 JavaScript，词典 + rule-based G2P |
| npm/license | Apache-2.0 metadata；但 bundled eSpeak NG GPL-3.0-or-later 风险未解决 | MIT metadata；无原生依赖，仍需核对 transitive licenses |
| 包体积 | tar 约 1.37 MB；unpacked 约 2.66 MB | tar 约 0.88 MB；unpacked 约 2.88 MB；2 个 runtime dependencies |
| Vite browser build | virtual entry build 成功，约 2.96 MB 未压缩 chunk | virtual entry build 成功，约 4.28 MB 未压缩 chunk；Node ESM 直接 import 因 JSON import attribute 失败，CJS 可用 |
| cold/warm observation | Node import 约 70 ms；首次 phonemize 约 144–161 ms；后续约 2–42 ms | CJS import 约 254 ms；后续调用约 0.02–6.5 ms |
| US/UK 行为 | eSpeak voice mapping 必须是 `us -> en-us`、`uk -> en`；GB 差异明显 | `en-US`/`en-GB` 可调用，但部分短语和专名没有差异 |

Compact golden-set observation（同一 Windows/Node 环境；IPA 原始输出未包 `/`）：

| Case | phonemizer US → UK | phonemize US → UK |
| --- | --- | --- |
| `Road House` | `ɹˈoʊd hˈaʊs` → `ɹˈəʊd hˈaʊs` | `ɹoʊd haʊs` → `ɹoʊd haʊs` |
| `categorize` | `kˈæɾɪɡɚɹˌaɪz` → `kˈatɪɡəɹˌaɪz` | `ˈkætəɡəˌɹaɪz` → same |
| `record` | `ɹˈɛkɚd` → `ɹˈɛkɔːd` | `ˈɹɛkɝd` → `ˈɹɛkəd` |
| `water` | `wˈɔːɾɚ` → `wˈɔːtə` | `ˈwɔtɝ` → `ˈwɔtə` |
| `schedule` | `skˈɛdʒuːl` → `ʃˈɛdjuːl` | `ˈskɛdʒuɫ` → `ˈʃɛdjuːɫ` |
| `tomato` | `təmˈeɪɾoʊ` → `təmˈɑːtəʊ` | `təˈmɑˌtoʊ` → `təˈmɑːtəʊ` |
| `car` | `kˈɑːɹ` → `kˈɑː` | `ˈkɑɹ` → `ˈkɑː` |
| `OpenAI` | `ˈoʊpən ˌeɪˈaɪ` → `ˈəʊpən ˌeɪˈaɪ` | `ˈoʊpɪneɪ` → same |
| `Qwertyblorf` | generated distinct US/UK forms | generated distinct US/UK forms |

The full 22-item set produced output for all 44 accent calls in both candidates. Accent output differed for 19/22 cases with phonemizer and 13/22 with phonemize. `record`, `present` and `read` are intentionally ambiguous bare words; no candidate can infer the intended part of speech without sentence context.

The unknown-word cases also exposed that both engines produce a plausible-looking guess for `Zzyzx` and `Qwertyblorf` instead of returning a confidence signal. Dogfood explicitly accepts those guesses for now; the adapter only applies lightweight input/output filtering and records obvious bad cases for later evaluation.

**Decision for this change:** approve `phonemizer@1.2.1` for private/local SayIt Dogfood only because it has materially better US/UK distinction, phrase behavior and proper-name handling in this bake-off. This is not approval for public distribution: the Apache package metadata does not settle the GPL-3.0-or-later eSpeak NG bundled-code obligation. Public distribution remains blocked pending a license/distribution review or replacement with a permissively licensed engine.

`phonemizer@1.2.1` is approved for private/local Dogfood only. Public distribution remains blocked pending a license/distribution review or replacement with a permissively licensed engine.

For Dogfood, do not add a numeric confidence system, another dictionary, or another service. The adapter only returns `null` for empty output, clearly non-language/code-like input, or engine failure; unknown-word G2P guesses are acceptable and can be recorded for later evaluation.

Regardless of winner, the chosen package is hidden behind SayIt’s `getIPA` adapter; React renderer and cache do not import the engine directly.

### 3. `getIPA` 的规范化、lazy 初始化和失败边界

实现层按以下顺序工作：

1. 保留用于 phonemizer 的原始表达文本，同时用 Unicode normalization、trim 和连续空白折叠生成 cache key。
2. 使用 `${accent}:${normalizedText}` 作为 key；同一 key 的并发请求共享同一个 Promise。
3. 首次需要 IPA 时动态加载/初始化已通过 decision gate 选定的 engine；初始化不阻塞 retrieve/interpret 结果渲染。
4. 将 `us`/`uk` 映射到选定 engine 的英美变体，读取非空 IPA 输出并统一为 `/.../` 展示形式。
5. 空输入、明显非语言/代码样式输入、空输出或 engine error 时返回 `null`；未知词的 engine G2P guess 可以返回，不引入 numeric confidence 或额外 dictionary/service。

cache 保存成功的 IPA 值，按表达和 accent 分开。MVP 可以使用 bounded browser-local cache；cache 解析、写入或容量失败时退回内存 cache，不影响 lookup 和结果操作。

### 4. UI 只为表达字段触发 lookup

结果 renderer 只对以下文本请求 IPA：

- retrieve `best_match.text`；
- retrieve alternatives 的 expression text（若存在且有可用结果）；
- interpret `interpretation.expression`。

IPA lookup 不对 natural sentence、Meaning in this context、Usage/reference、Explanation、Example 或任何结构性 label 触发。当前表达下方的小型 IPA 位置保持不变；没有 IPA 时只隐藏 IPA 行，不显示错误占位。

accent 改变后，UI 使用新 accent 的 cache key 重新读取本地结果；显示不会回退到旧 accent 的 IPA，也不会发送 `/api/retrieve`。

### 5. 其他备选方案

- **Windows 原生 eSpeak NG MSI + Node child process**：命令行可用 `--ipa -v en-us/en-gb`，确定性强，但要求安装/发现外部 executable，并引入本地 server 进程边界；会复杂化 one-click launcher。
- **`@jocelyn-stericker/espeak-phonemes`**：浏览器 WASM 更小，但需要非默认 Codeberg npm registry，且是 AGPL-3.0-or-later。
- **`ephone`**：提供 eSpeak NG phoneme generation 和 source mapping，但采用 GPL-3.0-or-later，当前不需要 source mapping。
- **手写/单独引入词典**：对 Road House 等短语、未知词和 G2P fallback 覆盖不足，且需要维护词典。

## Risks / Trade-offs

- [候选 engine 的初始化和约 MB 级 browser bundle 增加首次资源成本] → 仅在需要显示 IPA 时 lazy load；semantic result 首屏不等待 engine。
- [eSpeak NG IPA 与专业词典可能存在差异] → 将其定位为 Dogfood 学习提示，保留 `null` fallback 和可替换 adapter boundary。
- [专有名词/文化短语可能没有可靠转写] → engine 返回空、失败或输入被 lightweight filter 拦截时隐藏 IPA；未知词 guess 可以显示，但不回写 DeepSeek、不影响播放。
- [候选包的 license/distribution 义务或维护状态不适合发布] → 在实现前完成 license review 和 golden-set review；未通过前不锁定依赖。
- [本地 cache 数据损坏或容量受限] → bounded、safe parse、失败退回内存；cache 不是 semantic result 的依赖。

## Migration Plan

1. 先删除 contract、prompt、provider tests 和 fixtures 中的 LLM pronunciation 字段与校验。
2. 固定 `phonemizer@1.2.1` 作为私有/本地 Dogfood 依赖，新增 local lookup adapter、lazy initialization、cache 和单元测试；不得把该决定解释为公开分发许可。
3. 让 React 从 lookup state 渲染 IPA，保留现有 IPA 位置、accent selector、Web Speech playback 和 contextual actions。
4. 运行 typecheck、Vitest、build；手动验证 `Road House`、普通 retrieve expression、US/UK 切换、缓存命中和 lookup 失败。
5. 若 local engine 不可用，只隐藏 IPA；retrieve、interpret、Copy、Save、session context 和 Web Speech playback 继续工作。无需数据迁移或 API rollback。
