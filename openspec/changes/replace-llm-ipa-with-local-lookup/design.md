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

### 1. 采用浏览器端 `phonemizer` WASM

推荐固定 `phonemizer@1.2.1` 作为 MVP adapter 的底层 engine。它是基于 eSpeak NG 的浏览器可用 WASM 包，npm metadata 标示 Apache-2.0、0 个 runtime dependency，发布包约 1.37 MB，内置约 1.32 MB 的 distribution bundle；其 API 是异步 `phonemize(text, language?)`，返回 IPA 字符串数组，并提供 `en-us` 与 `en-gb` 语音变体。

选择它的原因：

- 不需要 Windows MSI、PATH 配置、child process 或额外本地服务，适合现有 Vite + browser launcher。
- 词典和 rule-based G2P 已在 eSpeak NG engine 内组合，能覆盖已知词、未知词和短语；不需要另外维护一份词典。
- US/UK 由同一个本地 engine 的 voice 参数选择，和当前 preference 模型一致。
- WASM 只用于 IPA phoneme generation，不替代当前 Web Speech API audio playback。

adapter 只暴露 SayIt 自己的 `getIPA` contract；React renderer 不直接依赖第三方包。

### 2. 明确三层职责

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

### 3. `getIPA` 的规范化、lazy 初始化和失败边界

实现层按以下顺序工作：

1. 保留用于 phonemizer 的原始表达文本，同时用 Unicode normalization、trim 和连续空白折叠生成 cache key。
2. 使用 `${accent}:${normalizedText}` 作为 key；同一 key 的并发请求共享同一个 Promise。
3. 首次需要 IPA 时动态加载/初始化 WASM；初始化不阻塞 retrieve/interpret 结果渲染。
4. 将 `us` 映射为 `en-us`，将 `uk` 映射为 `en-gb`，读取第一个非空 phonemizer 输出并统一为 `/.../` 展示形式。
5. 空输出、engine error 或无法得到可靠转写时返回 `null`；不得抛出会破坏结果页面的错误。

cache 保存成功的 IPA 值，按表达和 accent 分开。MVP 可以使用 bounded browser-local cache；cache 解析、写入或容量失败时退回内存 cache，不影响 lookup 和结果操作。

### 4. UI 只为表达字段触发 lookup

结果 renderer 只对以下文本请求 IPA：

- retrieve `best_match.text`；
- retrieve alternatives 的 expression text（若存在且有可用结果）；
- interpret `interpretation.expression`。

IPA lookup 不对 natural sentence、Meaning in this context、Usage/reference、Explanation、Example 或任何结构性 label 触发。当前表达下方的小型 IPA 位置保持不变；没有 IPA 时只隐藏 IPA 行，不显示错误占位。

accent 改变后，UI 使用新 accent 的 cache key 重新读取本地结果；显示不会回退到旧 accent 的 IPA，也不会发送 `/api/retrieve`。

### 5. 备选方案

- **Windows 原生 eSpeak NG MSI + Node child process**：命令行可用 `--ipa -v en-us/en-gb`，确定性强，但要求安装/发现外部 executable，并引入本地 server 进程边界；会复杂化 one-click launcher，因此不选作当前最小 Dogfood。
- **`@jocelyn-stericker/espeak-phonemes`**：浏览器 WASM 更小（项目说明约 300 KB WASM + 约 120 KB 压缩数据），但需要非默认 Codeberg npm registry，且是 AGPL-3.0-or-later；对当前项目的依赖和分发边界更复杂，暂不选。
- **`ephone`**：提供 eSpeak NG phoneme generation 和 source mapping，但采用 GPL-3.0-or-later，当前不需要 source mapping，未显示出足以抵消依赖/许可证成本的收益。
- **手写/单独引入词典**：对 Road House 等短语、未知词和 G2P fallback 覆盖不足，且需要维护词典；让 eSpeak NG 的内置 lexicon + rules 先承担这两个层次。

## Risks / Trade-offs

- [WASM 首次初始化和约 1.3 MB bundle 增加首次资源成本] → 仅在需要显示 IPA 时 lazy load；semantic result 首屏不等待 phonemizer。
- [eSpeak NG IPA 与专业词典可能存在差异] → 将其定位为 Dogfood 学习提示，保留 `null` fallback 和可替换 adapter boundary。
- [专有名词/文化短语可能没有可靠转写] → engine 返回空或失败时隐藏 IPA，不猜测、不回写 DeepSeek、不影响播放。
- [第三方包版本更新频率有限] → 固定 exact version，加入典型 US/UK golden fixtures；未来可在同一 adapter contract 后替换 engine。
- [本地 cache 数据损坏或容量受限] → bounded、safe parse、失败退回内存；cache 不是 semantic result 的依赖。

## Migration Plan

1. 先删除 contract、prompt、provider tests 和 fixtures 中的 LLM pronunciation 字段与校验。
2. 固定 `phonemizer` 依赖，新增 local lookup adapter、lazy initialization、cache 和单元测试。
3. 让 React 从 lookup state 渲染 IPA，保留现有 IPA 位置、accent selector、Web Speech playback 和 contextual actions。
4. 运行 typecheck、Vitest、build；手动验证 `Road House`、普通 retrieve expression、US/UK 切换、缓存命中和 lookup 失败。
5. 若 local engine 不可用，只隐藏 IPA；retrieve、interpret、Copy、Save、session context 和 Web Speech playback 继续工作。无需数据迁移或 API rollback。
