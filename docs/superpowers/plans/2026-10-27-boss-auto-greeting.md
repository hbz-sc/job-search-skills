# Boss Auto Greeting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 构建可在 Windows 本机按关键词采集 Boss 职位、串行发送指定常用语、验证结果并在额度上限停止的工具。

**Architecture:** 命令行驱动可恢复的串行任务，页面适配器只负责网页观察和动作，SQLite 记录意图和结果。只采集是默认模式，真实发送必须显式启动；大模型未配置时完全不参与核心流程。

**Tech Stack:** Node.js 24、TypeScript、Playwright、better-sqlite3、Vitest；本地测试网页使用 Node HTTP 服务，无 UI 框架、TypeORM、MCP、OpenClaw 或 Docker。

**Spec:** `docs/superpowers/specs/2026-10-27-boss-auto-greeting-design.md`（用户已批准）。

## Global Constraints

- Windows 本机、单进程、单账号、单个在处理的职位；深圳为初始城市，关键词必须显式提供。
- 只采集为默认；仅固定常用语招呼，不自动回复、交换联系方式、发送附件或启动定时任务。
- `VISION_ENABLED=false`、`DASHSCOPE_API_KEY=`、`VISION_BASE_URL=`、`VISION_MODEL=`；空 Key 不能阻止核心流程。
- 额度以平台明确提示为准；不硬编码第三方宣称的额度，不自动在次日恢复，不切换账号规避。
- 发送意图先落库；超时后核对，不自动重发待确认项。
- 登录态、密钥放 private/；数据库和投递记录放 data/；诊断文件放 output/；这些路径不进入 Git。
- 不修改私人简历，不覆盖既有 CSV 和 profile.json；原人工分析流程继续有效。
- 当前目录不是 Git 仓库。每个任务保留检查点，跳过 git commit；不得为满足模板擅自初始化 Git。
- 系统 PATH 中 Node 为 v16.20.0，不使用它安装或运行项目。已核验独立运行时为 v24.19.0：`C:/Users/30584/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe`。包装脚本只修改子进程 PATH，不改系统设置。

## Review Focus

1. 常用语点击可能直接发送，也可能只填入：两种情况必须都只产生一条目标消息（任务 4）。
2. 同一招聘者的不同岗位可能共享会话：跨岗位、跨关键词不得重复招呼（任务 2、4、5）。
3. 提交成功后进程崩溃、数据库未记成功：重启先核对会话，不能直接重试（任务 2、5）。
4. 控制台显示同名用户或浏览器登录账号改变：未可靠确认账号身份时禁止继续发送（任务 3、5）。
5. 列表虚拟化、重排或滚动无新增：按稳定身份处理并有限结束，不按卡片下标发送（任务 3、5）。

## 文件结构与职责

- `package.json`、`package-lock.json`、`tsconfig.json`、`vitest.config.ts`：依赖、构建和测试；执行阶段验证 Node 24 兼容性后固定版本和 lockfile。
- `scripts/boss.ps1`：定位独立 Node/npm，设置子进程 PATH，执行 install/typecheck/test/login/collect/send/status 等命令，不降级到系统 Node 16。
- `.env.example`、`config/boss.example.json`：不含身份、Key 和默认个人招呼的公共配置模板。
- `src/config.ts`、`src/domain.ts`：配置校验、共享类型、状态名称。
- `src/storage/store.ts`、`src/storage/schema.ts`、`src/storage/history.ts`：迁移、事务、去重与旧 CSV 只读匹配。
- `src/browser/session.ts`、`src/browser/boss-pages.ts`、`src/browser/selectors.ts`：独立登录目录、页面读取、具名定位规则与页面状态。
- `src/greeting.ts`：常用语固定、会话身份核验、单次发送及验证。
- `src/runner.ts`、`src/run-lock.ts`：串行循环、恢复、停止条件和单实例锁。
- `src/diagnostics.ts`、`src/vision.ts`：本地诊断与默认关闭的模型接口占位；不实现真实云端上传。
- `src/cli.ts`：中文命令行输出与参数；不把日志中的第三方文本当控制指令。
- `tests/*.test.ts`、`tests/fixtures/server.ts`、`tests/fixtures/pages.ts`：纯逻辑与本地浏览器行为测试。
- `README.md`、`.gitignore`、`AGENTS.md`、`.agents/skills/shenzhen-job-search/SKILL.md`：使用说明、忽略规则和两种使用模式的明确边界。

## Task 1: 无 Key 配置与可运行测试入口

**Files:** 创建运行包装脚本、项目清单、TS/Vitest 配置、公共配置模板、`src/config.ts`、`src/domain.ts`、`src/vision.ts`、`tests/config.test.ts`；更新 `.gitignore`。

**Interfaces:**

```ts
type Mode = 'collect' | 'send';
type Phase = 'discovered' | 'skipped' | 'opening' | 'chat_open' |
  'sending' | 'unconfirmed' | 'confirmed' | 'failed';
type StopReason = 'quota' | 'login' | 'verification' | 'identity' |
  'template' | 'layout' | 'errors' | 'exhausted' | 'maximum' | 'user';
type RunConfig = {
  mode: Mode; city: string; keywords: string[]; maxJobs?: number;
  browserDir: string; databasePath: string; outputDir: string;
  actionTimeoutMs: number; readRetries: number; noProgressLimit: number;
  consecutiveErrorLimit: number; intervalMs: number;
};
type Job = { key: string; url: string; company: string; title: string;
  recruiterId?: string; salary?: string; district?: string; city?: string;
  experience?: string; education?: string; description?: string;
  collectedAt: string; };
type Account = { key: string; displayName: string };
type Template = { text: string; hash: string };
type Evidence = { text: string; url: string; observedAt: string; screenshot?: string };
type Conversation = { key: string; jobKey: string; recruiterId?: string;
  company: string; title: string; url: string };
type SendResult = { status: 'confirmed' | 'unconfirmed' | 'skipped'; evidence: Evidence };
function loadConfig(input: unknown, root: string): RunConfig;
function visionStatus(env: Record<string,string|undefined>): 'disabled' | 'not_configured' | 'reserved';
```

- [ ] 编写配置测试：`loadConfig({keywords:['AI 应用开发工程师']}, root).mode` 为 `collect`；城市为深圳；空关键词拒绝；`maxJobs=0` 拒绝；未设置 maxJobs 不补成 100/150；默认目录在项目 private/data/output 下；空模型配置返回 disabled。
- [ ] 创建最小测试入口并用独立 Node 安装项目本地依赖；不运行 upstream 脚本。测试先因缺少业务实现而失败：`powershell -File scripts/boss.ps1 test tests/config.test.ts`。
- [ ] 实现配置解析和类型。工程默认参数：动作超时 15000ms、只读重试 2 次、无新增 3 次、连续异常 3 次、条目间隔 5000ms；这些仅为可配置运行参数，不表示平台允许频率。
- [ ] 包装脚本允许 `-NodePath` 覆盖，要求 Node 24；npm 不可用时明确报错。JSON 配置使用 UTF-8，错误信息不输出密钥。VISION 开启但无 Key 返回 not_configured，核心仍可运行；有 Key 也只返回 reserved，不发请求。
- [ ] 运行配置测试与 typecheck；通过后记录任务检查点，不提交私有文件。

## Task 2: 持久化操作意图与保守去重

**Files:** 创建 `src/storage/schema.ts`、`store.ts`、`history.ts`、`tests/store.test.ts`。

**Interfaces:**

```ts
type Attempt = { id: string; runId: string; accountKey: string; jobKey: string;
  conversationKey?: string; templateHash: string; phase: Phase; evidence?: Evidence };
interface Store {
  beginRun(account: Account, config: RunConfig, template?: Template): string;
  saveJobs(jobs: Job[]): void;
  shouldSkip(accountKey: string, job: Job, conversationKey?: string): boolean;
  reserve(runId: string, accountKey: string, job: Job, template: Template): Attempt;
  updateAttempt(id: string, phase: Phase, evidence?: Evidence, conversationKey?: string): void;
  pending(accountKey: string): Attempt[];
  stopRun(runId: string, reason: StopReason, evidence?: Evidence): void;
  latestStop(accountKey: string): StopReason | undefined;
  close(): void;
}
function openStore(path: string): Store;
function loadLegacySentJobs(csvPaths: string[]): Set<string>;
```

- [ ] 编写真实临时 SQLite 测试：同账号同职位 reserve 二次失败；账号/会话维度跳过已发送和待确认项；同公司不同会话不误去重；sending 状态退出后重开仍出现在 pending；quota 停止信息跨日期仍保留。
- [ ] 编写旧 CSV 测试：含引号与换行字段正确解析；仅明确发送状态和可靠 job_id/链接参与匹配；draft 不算已发送；原文件内容不改变。
- [ ] 运行 `powershell -File scripts/boss.ps1 test tests/store.test.ts`，确认断言先失败。
- [ ] 使用事务建立 runs/jobs/templates/attempts 及身份索引。保留一个职位的未解决操作，核对后更新原记录，不新建发送意图掩盖 pending。旧记录无法可靠识别的只展示，不推断成功。
- [ ] 重跑上述测试与 typecheck，确认数据重开、唯一性和历史兼容后记录检查点。

## Task 3: 独立浏览器、只读采集及页面适配

**Files:** 创建 `src/browser/session.ts`、`boss-pages.ts`、`selectors.ts`、`tests/fixtures/server.ts`、`pages.ts`、`tests/browser.test.ts`。

**Interfaces:**

```ts
type PageState = { kind: 'ready' | 'login' | 'verification' | 'quota' | 'layout'; evidence: Evidence };
interface BossPages {
  state(): Promise<PageState>;
  account(): Promise<Account | undefined>;
  search(city: string, keyword: string): Promise<{filters: string}>;
  visibleJobs(): Promise<Job[]>;
  advanceList(): Promise<boolean>;
  restoreSearch(): Promise<void>;
  readInitialTemplate(): Promise<Template>;
  openChat(job: Job): Promise<Conversation>;
  inspectChat(conversation: Conversation, template: Template): Promise<
    { identityMatches: boolean; existingConversation: boolean;
      templateStatus: 'absent' | 'pending' | 'failed' | 'confirmed'; evidence: Evidence }>;
  chooseTemplate(template: Template): Promise<'filled' | 'submitted' | 'unknown'>;
  submitFilledTemplate(template: Template): Promise<void>;
  verifyTemplate(template: Template): Promise<SendResult>;
  reopenAttempt(attempt: Attempt): Promise<Conversation | undefined>;
  captureDiagnostic(reason: string): Promise<Evidence>;
  close(): Promise<void>;
}
function launchBossPages(config: RunConfig): Promise<BossPages>;
```

- [ ] 创建 localhost 测试服务，提供列表重排、虚拟滚动、下架、同名不同职位、缺失字段、账号切换、quota/login/verification 场景。测试服务只允许本机连接，测试结束关闭；真实域名不进入自动测试。
- [ ] 编写 browser 测试：读取列表不触发任何沟通计数；ID/规范化链接稳定；缺失字段不编造；滚动后重新定位；账号只有昵称而无可靠身份时 account 返回 undefined；上限来自页面提示，不来自本地计数猜测。
- [ ] 运行 `powershell -File scripts/boss.ps1 test tests/browser.test.ts` 确认先失败。
- [ ] 实现持久化浏览器目录及 DOM 适配，常用语优先从设置页或已有会话只读获取，不为读取模板新建沟通。没有只读入口时停止并说明，不擅自创建新会话。身份必须基于页面可得的稳定标识或显式可核对信息，不能仅昵称匹配。
- [ ] 定位规则集中放 selectors.ts；按钮匹配限制在已核验面板内。测试页面提供语义结构用于分支验证，不能把 mock 测试通过当作真实 Boss 选择器已适配。
- [ ] 将聊天接口暂以明确未实现异常保留给任务 4；只读接口测试及 typecheck 通过后记录检查点。

## Task 4: 指定常用语单次发送与结果核验

**Files:** 创建 `src/greeting.ts`、`tests/greeting.test.ts`；完善 `boss-pages.ts` 聊天接口与 fixtures。

**Interfaces:** 消费 BossPages、Store 和共享类型；产生：

```ts
function greetOne(input: { pages: BossPages; store: Store; runId: string;
  account: Account; job: Job; template: Template; signal: AbortSignal }): Promise<SendResult>;
function reconcile(input: { pages: BossPages; store: Store; account: Account;
  template: Template; signal: AbortSignal }): Promise<void>;
```

- [ ] 编写本地浏览器测试：常用语直接发送与填入后发送各产生恰好一条目标消息；平台默认招呼不算目标模板；已有模板则零发送；模板重排仍选相同正文；模板被编辑则暂停。
- [ ] 编写身份/结果测试：错误接收人零发送；同招聘者不同职位共用会话只发一次；失败气泡不能 confirmed；只有气泡但缺少可靠状态为 unconfirmed；选择常用语后超时不得追加 Enter；已有会话无法确定时不发送。
- [ ] 运行 `powershell -File scripts/boss.ps1 test tests/greeting.test.ts` 确认先失败。
- [ ] 实现 greetOne：点击开聊前 reserve 并标 opening；会话核对后 chat_open；任何可能直接发送的常用语点击前标 sending；选择后重新观察，filled 才提交；每次写动作前检查 signal 和页面阻断状态，遇额度全局停止。
- [ ] 实现 reconcile：只打开可识别的已有会话读取，不能再次点「立即沟通」作为恢复；有可靠已发送证据则更新 confirmed，否则保留 unconfirmed；未可靠恢复不得重发。template 正文只规范化换行和外层空白，不进行模糊改写匹配。
- [ ] 运行任务 2–4 测试与 typecheck，通过后记录检查点。

## Task 5: 可停止的串行循环、恢复与诊断

**Files:** 创建 `src/runner.ts`、`run-lock.ts`、`diagnostics.ts`、`tests/runner.test.ts`、`tests/lock.test.ts`。

**Interfaces:**

```ts
type RunSummary = { runId: string; discovered: number; opened: number;
  confirmed: number; unconfirmed: number; skipped: number; stopReason: StopReason };
function run(input: { config: RunConfig; pages: BossPages; store: Store;
  signal: AbortSignal; resume: boolean }): Promise<RunSummary>;
function acquireRunLock(path: string): Promise<() => Promise<void>>;
function saveDiagnostic(outputDir: string, evidence: Evidence): Promise<string>;
```

- [ ] 编写 runner 测试，注入 fake BossPages 和临时 Store：collect 从不调用 openChat/chooseTemplate/submitFilledTemplate；关键词列表去重；每轮重新核对账号；第三次无新增结束；maxJobs 按独立职位处理量限制，不冒充平台额度。
- [ ] 编写中断测试：发送后数据库更新前模拟崩溃，下一次先 reconcile 且发送计数不增加；quota 后下一岗位零写操作；次日运行没有 resume 仍保留停止；resume 后先只读检查页面阻断状态，不能以日期代替额度证据；signal 中止后不开始下一动作。
- [ ] 编写锁测试：两个实例仅一个成功；锁记录本机 PID，活动进程锁不得覆盖；死进程锁仅在确认 PID 不存在时回收，无法确认则报错。
- [ ] 运行 `powershell -File scripts/boss.ps1 test tests/runner.test.ts tests/lock.test.ts` 确认先失败。
- [ ] 实现串行状态机，恢复等待项优先于新岗位；任务结束同时写停止原因。只读动作有限重试，写动作仅经任务 4 核对。连续三次普通读取异常停止；身份/模板/额度问题立即停止。
- [ ] 本地诊断只保存必要页面证据，按账号/任务隔离；中文终端不输出 Cookie/Key。单任务最多 20 张截图，最多保留最近 10 次任务诊断，仅清理由本程序创建且已验证位于 output/boss 下的文件。不能删除投递数据库或私人材料。
- [ ] 运行任务 1–5 测试与 typecheck，通过后记录检查点。

## Task 6: CLI 交付、项目约定同步与验收

**Files:** 创建 `src/cli.ts`、`tests/cli.test.ts`；完善 `scripts/boss.ps1`；修改 `README.md`、`AGENTS.md`、本地求职 SKILL.md。

**Interfaces:** CLI 支持 `login`、`collect --keyword <文本>`（可重复）、`send --keyword <文本> [--max-jobs N] [--resume]`、`status`；可选择公共示例复制出的本地配置文件。login 只启动登录窗口，不搜索或发送；status 不启动浏览器。

- [ ] 编写 CLI 测试：默认 collect；send 是显式命令；缺关键词退出非零；login/status 零发送；发送前输出城市/实际筛选/关键词/完整模板/停止条件；Ctrl+C 传递 AbortSignal 并输出 pending 数量；空 Key 全流程不调用网络模型。
- [ ] 运行 `powershell -File scripts/boss.ps1 test tests/cli.test.ts` 确认先失败。
- [ ] 实现入口、中文进度和完成摘要。人工分析配置 manual_only 不被程序悄悄改写；显式 send 表示本轮执行模式，命令行摘要说明覆盖范围，不持久化成无人值守默认。
- [ ] 更新使用约定：保留人工分析默认，记录用户已批准开发自动招呼工具；只有用户明确启动该轮 send 才执行发送，历史日额度不自动重置。记录实际启动命令、独立 Node 使用方式、登录持久化、停止恢复、待确认处理、空 Key、真实页面尚未验证的边界。
- [ ] 运行 `powershell -File scripts/boss.ps1 typecheck`、`powershell -File scripts/boss.ps1 test`、构建及 `status` 冒烟；全部成功才声称本地验证通过。检查忽略规则，确认无 Key/登录态/私人材料出现在可交付文件。
- [ ] 用户允许时进行真实页面只读适配，验证关键词、职位身份、模板读取与登录复用；当前电脑 UI 操作遵守可用工具约束，不能为绕过工具连接错误偷偷替换控制路径。若真实页面无法访问，明确交付为“本地测试通过、实站未验证”。
- [ ] 真实发送单岗位验收仅在该轮用户明确要求后进行；保存正确会话与指定常用语的可见结果，再按其要求扩大循环。未获得真实成功证据时不得宣称已打招呼或已投递附件。

## 自检结论

已覆盖设计的浏览器登录、关键词队列、模板固定、单次发送、发送状态验证、历史兼容、进程锁、崩溃恢复、额度停止、人工暂停、无模型运行和本地资料隔离。模型云端调用按用户要求延期，仅保留默认关闭的配置，不在第一版增加自动图片上传。

执行方式尚未选择。本计划推荐本会话顺序实施，理由是任务 2–5 共用类型、存储和页面接口，连续实现更容易保持一致；完成后进行一次独立审阅。
