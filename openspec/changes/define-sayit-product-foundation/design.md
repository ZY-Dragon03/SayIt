## Context

当前项目只有 OpenSpec 结构，没有既有应用、用户账户或远程数据层。产品动机和变更范围见 `proposal.md`；可验证的用户行为见：

- `specs/expression-retrieval/spec.md`
- `specs/local-expression-memory/spec.md`

设计受以下约束支配：

- 主要使用场景是桌面浏览器中反复、快速地检索英语表达。
- 输入可能同时包含语义不完整、拼写噪声和语法噪声。
- 用户不应被迫判断自己需要哪一种语言单位。
- 默认结果必须紧凑，解释使用简单英文，不能自动附加中文翻译。
- API 密钥不能进入浏览器；初始模型使用 DeepSeek，但不能让领域逻辑依赖单一提供商。
- MVP 应可廉价部署、无账户运行、易测试，且不提前引入搜索索引、向量数据库、后台任务或复杂状态管理。
- 交付分为两个里程碑：先完成个人可用的 Dogfood MVP，再完成面向公开部署的 Production Hardening。后者不得成为前者的前置条件。

## Goals / Non-Goals

**Goals:**

- 把 SayIt 定义为“表达检索引擎”：先推断意图，再返回最有用的自然表达。
- 为一次输入提供一个优先答案、少量替代项和一个可直接使用的自然句子。
- 在模型结果不确定时诚实表达不确定性，而不是堆叠解释或伪造确定答案。
- 将 typing noise、grammar noise 和 expression gap 分离，只有最后一类默认进入学习重点。
- 让第一次使用不需要账户、配置或语言学知识。
- 优先让个人用户尽快进入真实日常使用，并用真实反馈校准模型和交互，而不是等待所有生产设施齐备。
- 保持客户端轻量、键盘优先、响应式，并让本地保存项在离线时仍可用。
- 通过版本化的结构化契约和提供商适配层，为未来替换模型或增加入口保留边界。

**Non-Goals:**

- 不做完整词典、翻译器、通用语法检查器或开放式聊天机器人。
- 不自动翻译成中文，不默认讲解语法，也不把每次输入变成课程。
- 不在 MVP 中做账户、云端同步、远程词库、社交功能、积分、连续学习、间隔重复或分析仪表盘。
- 不在 MVP 中做浏览器扩展、全局快捷键、浮动窗口、剪贴板监听或桌面原生客户端。
- 不使用 RAG、向量搜索、专门词典服务或多代理流程来解决一个单轮结构化生成问题。
- 不把公开部署级别的基础设施、正式质量门槛或完整观测系统作为 Dogfood MVP 的完成条件。

## Product Definition

### 核心 JTBD

当我知道自己大概想表达什么、但不知道自然英语怎么说时，我希望输入一小段不完美的英语并立即得到最有用的词、短语、词块或完整句子，这样我可以继续工作，而不必先学习语言学术语或写一段提示词。

### 主要用户

首要用户是能够输入一些英语、但经常缺少自然表达的非母语英语使用者，尤其是写邮件、文档、代码注释、学习笔记或工作沟通的学生与知识工作者。第一版不针对英语零基础用户，也不把专业翻译人员作为优化目标。

### 中心产品身份

“反向词典”只回答“这个描述对应哪个词”；SayIt 的最小价值单元是“在这个意图和语境中，什么英文表达最值得直接使用”。因此，`word` 只是结果类型之一，最佳结果可能是搭配、短语动词、词块、句型或完整句。

这个区分足以成为中心身份，但必须由交互兑现：界面不能让用户先选择词类，结果不能只显示一个孤立的词，且自然句必须说明表达如何落地。产品仍要保持边界，不能因为能够生成句子就变成聊天应用。

### 核心使用循环

```text
+-------------+    Enter     +-------------+    2-8 sec    +----------------+
| Focus input | ------------> | Validate    | ------------> | Compact result |
| type thought|               | and submit  |               | copy / save    |
+-------------+               +-------------+               +--------+-------+
       ^                              |                              |
       |                              v                              |
       +-------------------- edit / retry <--------------------------+
                                      |
                                      v
                              continue with next input
```

默认循环只有一页、一次提交和一次结果查看。保存是可选动作，不阻塞下一次检索。

### 产品原则

1. **Usefulness over completeness**：先给用户现在能用的表达，不给百科全书。
2. **Infer quietly**：系统负责推断表达粒度，用户不需要分类。
3. **Noise is not learning**：明显 typo 不抢占学习注意力。
4. **Compact by default**：解释是条件性的，结果层级固定。
5. **Naturalness over literalness**：优先常见、符合语境的自然表达，而不是逐字修复。
6. **Honest uncertainty**：不确定时给少量候选或一个问题，不假装有唯一答案。
7. **Keyboard first**：输入、提交、复制、保存和关闭辅助面板都可用键盘完成。
8. **Local by default**：保存项留在浏览器；未获同意不建立账户或远程记忆。
9. **Provider agnostic**：DeepSeek 是适配器，不是产品领域模型。
10. **Fast feedback**：先给明确的提交状态和可恢复错误，不让界面看起来卡死。

## Delivery Milestones

产品行为、结构化结果契约、provider abstraction、服务端 secret boundary 和 localStorage 决策在两个里程碑之间保持不变。变化只在交付顺序和非功能性保障的深度。

### Milestone 1 — Dogfood MVP

目标是让个人用户尽快把 SayIt 放进日常工作流，而不是先完成一个面向公众的生产平台。

Dogfood MVP MUST 包含：

- 一个桌面优先、可在个人设备上使用的主页面。
- 一个可自动聚焦的多行输入框；单次输入最多 500 个字符；Enter 提交，Shift+Enter 换行。
- 一个最小同源 `/api/retrieve` proxy；DeepSeek 调用和 API key 只在服务端发生。
- 基础请求校验、响应 schema 校验、一次明确的超时/失败处理，不渲染非法模型输出。
- `success`、`needs_clarification`、`no_match` 和基本服务错误状态。
- 固定层级的结构化结果：Best match、Useful expressions、Natural version，以及必要时的 Explanation。
- 复制最佳表达、替代表达和自然句子的操作。
- 显式保存、查看、复制和删除 localStorage 中的表达快照。
- 基础键盘操作、输入保留、Retry 和足够清晰的 loading/error 反馈。
- 至少一次真实 DeepSeek model smoke test，确认从输入到结构化结果的完整链路可用。
- 本地运行或私有部署均可；若部署到远程环境，必须保持 API 不公开暴露且 secret 不进入浏览器。

Dogfood MVP MUST NOT 被以下事项阻塞：

- 公开部署级别的 rate limiting、abuse protection、成本告警和多租户配额。
- 完整 CSP/CORS 安全策略、正式观测平台和一键生产回滚。
- 全套 Playwright E2E、可访问性审计、性能预算和正式模型质量门槛。
- 完整 Fluent/acrylic 视觉打磨、PWA、账户、同步、分析或扩展入口。

Dogfood 的最低退出条件是：个人用户能输入真实工作中的 messy English，在几秒内得到合法结构化结果，复制表达，主动保存，并连续使用多次而不丢输入或保存项。

### Milestone 2 — Production Hardening

第二里程碑不改变产品定位或核心 API 契约，而是使同一 MVP 能够安全、可观测、可回滚地面向更广泛用户：

- 公开部署保护、rate limiting、abuse protection、成本上限和告警。
- CSP、CORS、HTTPS、安全响应头、日志隐私和更严格的请求边界。
- 非敏感 observability，包括延迟、错误类别、模型质量和成本指标。
- 完整单元、API 集成、E2E、可访问性、响应式和性能验证。
- 版本化 prompt/model/schema 的正式质量门槛、兼容策略和回滚流程。
- 完整 Fluent/Windows 11 视觉打磨、焦点细节和多浏览器验证。

### 共享非目标

- 自动查询历史。只有用户主动保存的项目被持久化。
- 账户、登录、跨设备同步和远程保存。
- 中文翻译、双语释义或自动词汇课程。
- “再问一个问题”的多轮聊天上下文。
- 语音、图片、文档批量输入或剪贴板监听。
- 浏览器插件、PWA 离线检索、全局快捷键和桌面通知。
- 复杂筛选、标签、搜索、统计、排行榜、连续打卡和进度图表。

## Information Architecture

MVP 不需要传统导航或仪表盘，信息架构保持为一个主任务和一个辅助面板：

```text
+----------------------------------------------------------------+
| SayIt                                      Theme    Saved (n)  |
+----------------------------------------------------------------+
|                                                                |
|                    [ Expression input ]                       |
|                    [ Enter to retrieve ]                      |
|                                                                |
|                    [ Compact result ]                         |
|                    Best match                                  |
|                    Useful expressions                          |
|                    Natural version                             |
|                    Explanation (only when useful)              |
|                                                                |
+----------------------------------------------------------------+
                         |
                         v
                 [ Saved expressions drawer ]
```

- 主页面 `/` 是唯一必需路由。
- Saved 使用抽屉、弹层或同等轻量区域，不创建单独的 dashboard。
- 主题控制、保存入口和错误状态必须不挤占输入的视觉优先级。

## Main Interaction States

| 状态 | 触发 | 用户看到的内容 | 可用操作 |
| --- | --- | --- | --- |
| `idle` | 首次打开或清空输入 | 空输入提示和示例 placeholder | 输入、打开保存项 |
| `editing` | 输入内容变化 | 字符限制和提交提示 | Enter 提交、Shift+Enter 换行 |
| `submitting` | 通过校验后提交 | 输入保留、轻量 loading、禁止重复提交 | 等待或取消当前视觉等待 |
| `success` | 收到合法成功结果 | 紧凑结果面板、Copy、Save | 复制、保存、编辑后再次提交 |
| `needs_clarification` | 意图不够确定 | 一个英文问题和有限候选 | 修改输入或选择候选后再次提交 |
| `no_match` | 没有可靠表达 | 简短英文提示，不伪造答案 | 修改输入、重试 |
| `service_error` | 网络、限流、超时或上游错误 | 可理解的可恢复错误 | Retry，输入不丢失 |
| `saved_drawer` | 用户打开保存项 | 最近保存项和空状态 | 查看、复制、删除、关闭 |
| `storage_error` | 本地写入失败 | 非阻塞错误提示 | 重试、继续使用未保存结果 |

结果返回后输入框应继续可聚焦，方便用户立即开始下一次检索；错误不能清空输入。

## Result Format

### 默认渲染层级

1. **Best match**：突出一个 `best_match.text` 和类型。
2. **Useful expressions**：最多 3 个有明确用途的候选，不强行凑数。
3. **Natural version**：一个能代表用户意图的完整自然句。
4. **Explanation**：只有存在近义项、搭配限制或容易误解时才显示一小段英文。
5. **Noise details**：默认不抢占主内容；需要透明度时以轻量的 normalized/typo 信息展示。

`inferred_intent` 是简短的英文语义摘要，不是模型思考过程，也不是用户必须阅读的教学段落。MVP 不向用户显示数值 confidence，因为模型自报置信度容易产生虚假精确感；不确定性通过状态和候选表达。

### 推荐的 LLM/领域结果契约

模型输出和服务端归一化后的核心数据采用以下形状。实际实现应使用运行时 schema 校验，而不能只依赖 TypeScript 类型。

```json
{
  "schema_version": "1",
  "status": "success",
  "normalized_input": "put many things in one category based on a shared feature",
  "inferred_intent": "organize items by shared characteristics",
  "best_match": {
    "text": "categorize",
    "base_form": "categorize",
    "expression_type": "word"
  },
  "alternatives": [
    {
      "text": "categorize items by type",
      "expression_type": "lexical_chunk"
    },
    {
      "text": "group them into categories",
      "expression_type": "lexical_chunk"
    }
  ],
  "natural_sentence": "Categorize the items based on their shared characteristics.",
  "short_explanation": null,
  "typo_corrections": [],
  "learnable_items": [
    {
      "text": "categorize",
      "expression_type": "word"
    }
  ],
  "clarifying_question": null
}
```

契约决策：

- `status=success` 时 `best_match` 和 `natural_sentence` 必须存在；其他状态可以将其设为 `null`。
- `best_match` 和 `alternatives` 使用对象而非裸字符串，以便未来添加词形、使用限制或注册信息而不破坏渲染。
- `alternatives` 最多 3 项，且不得只是同一个表达的重复词形。
- `expression_type` 使用固定枚举：`word`、`collocation`、`phrase`、`lexical_chunk`、`phrasal_verb`、`idiom`、`sentence_pattern`、`sentence`。
- `short_explanation`、`clarifying_question` 没有必要时为 `null`，客户端不渲染空区域。
- `typo_corrections` 记录 `original`、`corrected` 和 `kind`；它是透明度元数据，不自动进入 `learnable_items`。
- `learnable_items` 只包含表达缺口，可选包含简短英文 `why`；不包含明显 typo。
- 所有用户可见语言字段必须是英文；元数据字段使用稳定的机器值。
- 契约需要 `schema_version`，以便未来增加字段时保持保存快照可读。

## Noise and Intent Strategy

噪声处理不是独立的“先把所有文字改正确”的拼写检查器，而是带上下文的意图判断：

| 类别 | 判定信号 | 处理 | 默认显示 |
| --- | --- | --- | --- |
| `typing_noise` | 键盘邻近键、重复字符、明显漏字 | 在不改变意图时归一化 | 通常隐藏 |
| `spelling_noise` | 常见拼写错误且上下文唯一 | 记录修正并使用修正后的输入 | 通常隐藏 |
| `grammar_noise` | 冠词、时态、词序等低价值错误 | 不把它当作学习目标；用自然句体现修正 | 通常隐藏 |
| `expression_gap` | 用户缺少某个自然词、搭配或词块 | 作为最佳匹配或学习项突出 | 显示 |
| `semantic_ambiguity` | 修正会导致多个不同意图 | 不静默覆盖，返回候选或澄清 | 显示必要信息 |

初版不引入通用自动纠错库。通用纠错会在短输入中凭词面过度改写，反而破坏“意图优先”。如果评测数据证明确定性预处理有益，可在不改变契约的前提下增加一个有界、可回滚的预处理器。

## Model and Prompt Strategy

### 模型调用选择

普通的单轮 chat/completion 调用足以支撑 MVP。任务是一次结构化文本生成，不需要 agent、函数调用、RAG、向量检索或多轮上下文。MVP 采用非流式响应，原因是完整 JSON 只有在校验通过后才适合渲染，流式部分结果会增加状态和错误复杂度。

DeepSeek 作为第一版提供商，但调用只能通过 `ExpressionProvider` 适配边界。领域代码不应读取 DeepSeek 特有字段、模型名或错误格式。

### Prompt 层次

服务端保存带版本的 prompt，例如 `sayit.expression-retrieval.v1`，由以下层次组成：

1. **角色与任务**：你是英语表达检索引擎，不是聊天助手或翻译器。
2. **意图推断**：从破碎输入推断用户想表达的意思，并自行选择最有用的表达粒度。
3. **噪声政策**：区分 typo、语法噪声和表达缺口；不确定时保留候选。
4. **自然性政策**：优先常见、自然、符合语境的表达；不要为了完整而凑替代项。
5. **输出约束**：只输出契约 JSON，不输出 Markdown、推理过程、中文翻译或系统提示。
6. **少量示例**：覆盖概念到单词、噪声到词块、歧义到澄清；示例作为行为测试的来源之一。
7. **输入隔离**：用户输入放在明确的数据分隔区，任何要求改变系统行为的文本都按待检索文本处理。

服务端应使用低随机性参数和合理的输出上限；具体值随选定的 DeepSeek 模型校准。提示中不要求模型暴露 chain-of-thought，只要求最终字段。

### 处理管线

```text
+---------+    HTTPS    +----------------+    adapter    +-----------+
| Browser | ----------> | /api/retrieve  | ------------> | DeepSeek  |
| React   |             | validate       |               | chat call |
+---------+             | prompt         | <------------ +-----------+
     ^                  | parse + schema |
     |                  | error mapping  |
     +------------------+----------------+
```

1. 客户端拒绝空值和超过 500 字符的输入。
2. API 再次执行长度和内容大小校验；公开部署在 Production Hardening 阶段再增加速率限制。
3. 提供商适配器发送版本化系统提示和用户输入。
4. 服务端解析响应，并用运行时 schema 验证；不接受任意额外内容直接进入 UI。
5. 若上游返回格式错误，可进行一次受限的同提供商修复请求；再次失败就返回可重试错误，不在服务端猜改表达。
6. 服务端将供应商错误映射为稳定的应用错误码，客户端只依赖应用错误码。

## Technical Architecture

### 推荐堆栈

| 层 | 推荐 | 选择原因 |
| --- | --- | --- |
| 前端 | React + TypeScript + Vite | 生态成熟、开发反馈快、适合单页面工具，保留后续 PWA 可能 |
| 样式 | 原生 CSS/ CSS Modules + CSS variables | 足够表达 Fluent 风格，避免重型组件库和不可控默认样式 |
| 运行时校验 | Zod 或同等轻量 schema 库 | LLM、API 和 localStorage 都是不可信边界，TypeScript 静态类型不够 |
| API | TypeScript 的同源 serverless/edge handler | 无状态、低运维、密钥留在服务端；本地用 Vite proxy |
| 模型 | DeepSeek 适配器 | MVP 成本低；通过接口保持可替换 |
| 测试 | Vitest、Testing Library、Playwright、axe 规则 | 覆盖纯逻辑、可访问性、API 集成和真实键盘流程 |

不建议在 MVP 使用 Next.js/Nuxt 等全栈框架来获得并不存在的页面路由需求，也不建议引入 Express、Redux 或大型 UI 套件。若部署平台强制提供某种函数运行时，只增加一个薄适配层，不改变领域接口。

### 前端模块边界

前端只需要少量职责：

- `input surface`：编辑、字符限制、提交和焦点。
- `retrieval state`：idle/submitting/result/error 的状态机。
- `result renderer`：只按经过验证的契约渲染固定层级。
- `clipboard action`：复制内容并给出短暂反馈。
- `local memory`：保存快照、读取、删除、迁移和存储错误。
- `saved drawer`：列表和详情，不承担检索领域逻辑。
- `theme/a11y tokens`：主题、焦点、对比度和 reduced motion。

MVP 使用 React 局部状态和少量共享 context 即可，不需要全局状态库、事件总线或客户端路由框架。

### API 代理

建议提供一个同源端点：

- `POST /api/retrieve`：请求 `{ "input": "..." }`，返回经过验证的结果契约。
- `400`：输入无效或超长。
- `429`：请求过于频繁。
- `502`：上游提供商失败或返回不可用结果。
- `504`：超时。
- `500`：未分类服务错误，不向用户暴露内部细节。

所有错误响应使用稳定形状，例如 `{ "error": { "code": "...", "message": "...", "retryable": true } }`。`message` 是适合用户或客户端映射的简短文本，不包含密钥、完整上游响应或系统提示。

### 提供商抽象

领域层只依赖一个最小能力：给定输入和 prompt 版本，生成符合目标结果契约的候选文本。DeepSeek adapter 负责鉴权、模型参数、HTTP 错误和响应格式差异；未来的其他 LLM adapter 复用相同的领域校验。

provider adapter 不应暴露给客户端，也不应让 UI 根据提供商名称分支。模型名称和密钥来自服务端环境变量，部署配置变更不需要修改前端。

### 分阶段拓扑

Dogfood MVP 采用最小可用拓扑，不引入数据库、认证服务、队列或公开 API 网关：

```text
+---------+       same-origin       +----------------+       HTTPS       +-----------+
| Browser | ----------------------> | Minimal proxy | ----------------> | DeepSeek  |
| React   |                         | validate      | <---------------- | chat call |
+----+----+                         +----------------+                  +-----------+
     |
     v
 localStorage
```

Dogfood proxy 只需要完成输入边界校验、DeepSeek 调用、基础超时/错误映射和结果 schema 校验。它可以作为本地开发服务器路由或私有部署函数运行；如果远程运行，必须通过部署环境限制访问，不能把未经保护的匿名端点暴露到公网。

Production Hardening 在同一逻辑边界外增加公开部署所需的 rate limiting、abuse protection、成本控制、CSP/CORS、安全响应头、非敏感 observability 和回滚机制：

```text
+---------+    HTTPS    +-------------------+    +----------------+
| Browser | ----------> | Public edge/API   | -> | Minimal proxy  | -> DeepSeek
+---------+             | limits + headers  |    | same contract  |
                        +-------------------+    +----------------+
```

两种拓扑共享 `POST /api/retrieve`、provider abstraction、结果契约和 localStorage；生产加固不应迫使 Dogfood 预先引入另一套领域架构。

## Persistence Strategy

### 选择 localStorage

MVP 的保存对象是少量、小体积、文本为主的快照，因此优先使用带命名空间的 `localStorage`：

| 方案 | 优点 | 缺点 | 决策 |
| --- | --- | --- | --- |
| `localStorage` | API 极小、可同步读取、易调试、部署零成本 | 容量小且同步写入 | MVP 采用 |
| IndexedDB | 容量大、异步、适合大量记录 | API 和迁移复杂度更高 | 未来有大量历史/媒体时再采用 |
| 远程数据库 | 可同步、可跨设备 | 账户、隐私、运维和成本显著增加 | 明确排除 |

存储包使用版本号、命名空间和记录校验，例如 `sayit.saved.v1`。保存记录包含稳定 id、创建时间、原始输入和结果快照。保存动作是显式的；不持久化完整查询历史，不上传本地保存项。

达到浏览器配额时，客户端必须报告失败并保留当前结果。不要在用户不知情时把保存项发送到 API。未来增加账户时，通过 `MemoryRepository` 边界替换存储实现，而不是让 UI 直接访问数据库。

## Security and Privacy

安全边界按里程碑分层，但 API key 不进入浏览器是两个里程碑都不可退让的条件：

- **Dogfood baseline**：服务端 secret、同源访问、请求大小/输入边界、schema 校验、上游超时和不记录原始输入；远程 Dogfood 只能使用私有访问控制。
- **Production Hardening**：公开部署的 rate limiting、abuse protection、成本上限、CSP/CORS、安全响应头、非敏感 observability 和更完整的隐私审计。

- API key 只存在服务端环境变量，浏览器 bundle、source map 和错误消息都不得包含它。
- 私有远程 Dogfood 使用 HTTPS 和同源请求；本地 localhost 可使用本地开发协议；若生产环境前后端分离，CORS 只允许实际前端 origin。
- 服务端限制请求体和输入长度并设置上游超时；公开部署再增加按 IP/设备的 rate limiting、abuse protection 和成本控制。
- 默认不记录原始输入、完整模型响应或保存项；必要日志只记录 request id、延迟、状态和错误类别。
- 用户输入被当作不可信数据和 prompt injection 载荷处理；没有工具调用、文件访问或任意代码执行路径。
- 服务端 schema 校验、字段长度上限和允许枚举防止模型输出污染 UI 或日志。
- 本地保存内容可能包含敏感英语文本；界面提供单项删除和清空入口，并在隐私说明中明确“仅保存在当前浏览器”。
- 使用 CSP、`X-Content-Type-Options`、安全 cookie 策略（若未来添加 cookie）等基础 Web 安全头。
- MVP 不做认证；Dogfood 只允许本地或私有部署，Production Hardening 前不得开放未经保护的公开匿名端点。

## Performance Targets

性能门槛按里程碑分层，不让正式生产指标阻塞首次个人使用：

- **Dogfood MVP**：提交后立即显示 loading；输入、焦点和本地保存保持即时；真实模型请求有明确超时和可恢复错误；能在个人日常工作中稳定完成“输入 -> 结果”的循环即可，不设置公开发布级 p50/p95 门槛。
- **Production Hardening**：以下目标用于公开部署前的性能验收，不是对第三方模型延迟的硬保证：

- 初始静态 shell 在常见桌面宽带环境下 p75 小于 1.5 秒可交互。
- 输入响应、焦点和本地保存操作 p95 小于 100 ms。
- 提交后立即显示 loading；模型结果 p50 目标小于 3 秒，p95 目标小于 8 秒。
- API 自身（不含上游模型）增加的延迟目标小于 200 ms。
- 上游超时目标 12 秒，客户端始终有可恢复错误，不无限等待。
- 初始 JavaScript 以轻量为目标，避免为一个页面加载大型组件库、图标包或分析 SDK。

如果真实模型延迟超过目标，第一优先级是清晰的等待和重试体验，而不是在 MVP 加入流式 JSON、并行模型或复杂缓存。请求缓存也可能泄露用户输入，默认不启用。

## Visual and Interaction System

视觉方向在两个里程碑保持一致。Dogfood 只需要清晰、轻量、键盘可用的基础样式；完整 Fluent/acrylic 打磨、跨浏览器检查和细节级可访问性验收属于 Production Hardening，不应阻塞个人试用。

### 视觉

- 使用 `Segoe UI` 或系统无衬线字体，正文和结果保持高可读性。
- 以中性背景、单个主输入面板和单个结果面板形成层次；避免卡片网格和装饰性统计。
- 圆角、轻阴影和低强度边框表达 Windows 11/Fluent 气质；acrylic/backdrop-filter 只作为渐进增强，性能或浏览器不支持时回退为不透明表面。
- 用 CSS 变量管理背景、文本、边框、强调色、焦点环和错误色；浅色和深色主题都满足对比度要求。
- 动效只用于提交反馈、结果出现和抽屉开关；遵守 `prefers-reduced-motion`。
- 错误、保存状态和焦点不能只靠颜色表达，必须同时使用文字、图标语义或边框。

### 键盘优先

- 页面载入后将焦点放在主输入；用户可以通过 Tab 完成所有操作。
- Enter 提交；Shift+Enter 插入换行。实现必须正确处理输入法 composition 状态，避免中文/日文输入组合过程中误提交。
- 结果返回后保留输入焦点或将焦点移动到明确的结果标题，二者需通过可访问性测试确定；不能让用户失去继续输入的路径。
- 复制和保存按钮有可见焦点、明确的 accessible name 和短暂成功反馈。
- Escape 关闭保存抽屉或弹层，不清空用户输入。
- 不绑定容易与浏览器或操作系统冲突的复杂全局快捷键；全局快捷键属于未来扩展。

### 响应式

- 桌面端以居中、限制最大宽度的单列为主，输入和结果垂直排列；宽屏不强行填充空白。
- 小屏幕保持同一信息层级，减少边距，输入区和结果区自然堆叠，保存项使用全宽抽屉或页面内层。
- 触控目标满足可操作尺寸，不能只依赖 hover。
- 不出现水平滚动；自然句和长表达在窄屏中可换行。

## Failure and Recovery

Dogfood MVP 先覆盖空输入、超长、网络失败、上游超时、非法模型响应、无匹配和 localStorage 失败；Production Hardening 再把公开限流、成本异常、CORS/CSP 违规和观测告警纳入正式故障演练。

| 故障 | 服务端行为 | 客户端行为 |
| --- | --- | --- |
| 空输入/超长 | 不调用模型，返回校验错误 | 保留文字并提示修改 |
| 网络断开 | 快速失败或等待浏览器网络恢复 | 显示 Retry；已保存内容仍可用 |
| 上游超时 | 中止请求并返回 `timeout`/`504` | 显示简短重试提示，不丢输入 |
| 上游限流 | 映射为 `rate_limited`/`429` | 告知稍后重试，不显示内部细节 |
| 非法 JSON/契约失败 | 最多一次受限修复；仍失败则 `invalid_provider_response` | 显示通用服务错误，不渲染半成品 |
| 无可靠意图 | 返回 `needs_clarification` 或 `no_match` | 显示有限候选或一个英文问题 |
| localStorage 配额/禁用 | 不回退远程写入 | 显示保存失败，结果继续可复制 |
| 损坏的保存记录 | 跳过坏记录并记录非敏感诊断 | 有效记录正常加载，并给非阻塞提示 |

## Testing Strategy

### 分阶段质量门槛

Dogfood MVP 的阻塞性验证只包括：schema/契约单元测试、输入边界测试、localStorage 基本读写、mock provider API smoke test，以及一次受控真实 DeepSeek model smoke test。这样可以证明核心链路可用，但不要求先完成完整测试矩阵。

Production Hardening 再增加完整的 API 集成、Playwright E2E、axe/人工可访问性、跨视口/主题、性能预算、安全审计和正式模型评测门槛。现有下列测试策略描述最终目标；任务阶段将其拆到对应里程碑。

### 单元和契约测试

- 输入边界：空白、500 字符边界、超长、Unicode 和输入法 composition。
- 噪声 fixture：`keybroad`、重复字符、明显 typo、语法噪声和会改变意图的歧义。
- 结果 schema：枚举、必填字段、`alternatives` 上限、状态与字段组合、英文内容约束。
- 渲染逻辑：空解释不占位、错误不清空输入、只显示 `learnable_items` 的学习重点。
- localStorage：保存快照、排序、删除、清空、配额失败、损坏记录和版本迁移。
- API 错误映射：超时、429、非 JSON、无效模型结果和未知上游错误。

### 模型评测集

建立小型、版本化的离线 fixture 集，至少覆盖：

- 描述到单词：`put many things in some category by same feature`。
- 噪声到表达：`type in keybroad also make mistake`。
- 语义推断：`nobody could say im hangging out`。
- 需要词块、搭配、短语动词、习语和完整句的输入。
- 多义输入、无法匹配输入、prompt injection 输入。

评测指标先关注行为而非模型自报分数：结构化有效率、输入意图命中率、噪声不被突出率、自然句可用率、无中文泄漏率、无幻觉率和端到端延迟。自然性仍需要人工抽样评审，不能只用字符串相等判断。

### 集成、E2E 和可访问性

- 使用 mock provider 测试 API，不让 CI 依赖真实 DeepSeek 费用或网络。
- 使用 Playwright 覆盖“聚焦 -> 输入 -> Enter -> 查看 -> Copy/Save -> 下一次输入”的键盘流程，以及窄屏和深色模式。
- 使用 Testing Library 验证可见行为，不测试内部组件实现细节。
- 用 axe 类规则和人工键盘检查验证标签、焦点、live region、对比度和 reduced motion。
- 真实模型只在受控的预发布评测中运行，密钥和输入数据不进入公开 CI。

## Deployment and Migration Plan

### Milestone 1 — Dogfood MVP

优先使用本地或私有部署，目标是尽快进入个人日常使用：

1. 先运行不依赖真实模型的前端和 mock API，确认输入、结果渲染、复制和 localStorage。
2. 通过服务端环境变量接入 DeepSeek，执行一次真实 model smoke test；环境变量不得使用会被 Vite 暴露到浏览器的 `VITE_` 前缀。
3. 使用同源的最小 `/api/retrieve` proxy；本地开发服务器、单机 Node handler 或私有 serverless function 均可。
4. 如果部署到远程环境，使用私有仓库/访问控制/网络限制，不开放未经保护的匿名公开 API。
5. 先以个人真实工作输入连续使用，记录明显错误和延迟问题，再决定是否进入 Production Hardening。

Dogfood 发布不需要正式 CDN、WAF、完整观测平台、公开 rate limit 或多环境回滚系统。

### Milestone 2 — Production Hardening

在 Dogfood 已证明核心循环有价值后，再将同一应用提升到公开部署：

1. 部署同源静态前端和无状态 `/api/retrieve` 函数，配置 HTTPS、CSP/CORS 和安全响应头。
2. 增加 rate limiting、abuse protection、成本上限、告警和非敏感 observability。
3. 运行完整模型评测、E2E、可访问性、性能和安全检查，达到正式质量门槛后再开放公众访问。
4. 建立 prompt/model/schema 版本兼容、静态资源原子发布和可验证回滚流程。

### 迁移与回滚

两种里程碑共享结果契约、prompt 版本、provider abstraction 和 localStorage 数据格式。MVP 无远程数据库，因此没有数据库迁移或数据恢复服务；localStorage 只需执行向后兼容的客户端迁移。

- Dogfood 模型质量异常：切换到上一个 prompt/model 配置或回退到 mock，不改客户端契约。
- Production 前端异常：回滚上一份静态构建。
- Production API 异常或费用激增：暂停公开入口或返回可恢复服务错误；本地保存项不受影响。
- localStorage schema 迁移失败：保留原始键并以只读/空列表启动，不能静默删除用户数据。

## Future Extension Points

现在就保留以下边界，但不实现功能：

- `ExpressionProvider`：替换 DeepSeek，或以后支持本地模型。
- `schema_version` 和版本化 prompt：支持模型升级和保存快照长期可读。
- `MemoryRepository`：未来可替换为账户同步或加密远程存储。
- 同源 `/api/retrieve`：浏览器扩展、PWA、全局快捷键或浮动窗口可复用，不直接接触模型密钥。
- `learnable_items`：未来可生成复习项，但当前不引入间隔重复算法。
- 明确的复制动作：未来可接入剪贴板工作流，但 MVP 不监听剪贴板。

这些扩展点只要求稳定接口和数据边界，不要求现在预建账户系统、消息队列、插件平台或事件追踪系统。

## Risks / Trade-offs

- **意图推断错误** -> 通过有限替代项、`needs_clarification`、离线评测集和人工抽样降低风险；不要用自报 confidence 掩盖错误。
- **过度纠正 typo** -> 不做无上下文的全量拼写重写；只在意图不变时归一化，歧义时保留候选。
- **模型输出漂移** -> 服务端 schema 校验、prompt 版本、固定 fixture 和 provider adapter；非法输出不进入 UI。
- **DeepSeek 延迟或不可用** -> 超时、重试/限流、明确错误、可替换 provider；不在 MVP 维护多模型路由。
- **匿名 API 被滥用** -> 请求大小限制、按 IP 限流、成本上限、最小日志和同源部署；后续若需要更强配额再评估账户。
- **localStorage 丢失或容量不足** -> 保存项是可选快照，提供删除/清空和明确失败反馈；高价值跨设备记忆留给后续同步方案。
- **产品滑向教学平台** -> 每个新增字段都必须证明能改善“立即找到可用表达”；默认不添加课程、统计或解释面板。
- **CSS acrylic 影响性能/可读性** -> 仅渐进增强，提供不透明回退和 reduced-motion/高对比度方案。
- **无流式结果的等待感** -> 先优化即时 loading 和延迟目标；只有真实使用证明必要时才评估流式协议。

## Open Questions

以下问题不改变已确定的产品契约；只有与 Dogfood 直接相关的问题需要在第一次个人试用前决定：

### Dogfood 前

1. 选择本地开发服务器、单机 Node handler 或私有 serverless function 作为最短可用路径。
2. DeepSeek 当前可用模型中，哪一个在低延迟、英文自然性和结构化输出稳定性之间最适合第一次 smoke test。
3. 选定模型是否支持原生 JSON/schema 模式；若不支持，使用普通 completion 加服务端校验和一次修复请求。
4. 结果返回后焦点是留在输入框还是移动到结果标题；通过个人键盘流程测试选择，不阻塞核心链路。

### Production Hardening 前

1. 选择能够以同一 origin 托管静态前端和无状态 API 函数的正式部署平台。
2. 确定正式评测集的人工通过阈值，以及何种失败率会阻止公开发布。
