# 验收记录

## 2026-10-29：0.2.0 工作流代码

- 本地实现：固定搜索、职位详情与稳定目标核对、恢复列表、第一条常用语直接发送/填入后发送、结果核对、项目级去重与串行循环。
- 不再采集账号区域标识和姓名哈希。保留连接目标校验、历史 SQLite/CSV 记录、人工发送默认和额度停止。
- 独立审查六项问题已通过复现测试修复：停止时的待执行点击、无关导航、同名职位错配、CSV 历史遗漏、分页加载等待、返回时的进度丢失。另补 host 停止/启动竞争测试。
- 最终本地检查：TypeScript typecheck/build、扩展构建通过；26 个 Vitest 文件共 105 项通过；17 项 Python unittest 通过。测试日志位于 .superpowers/sdd/2026-10-29-boss-current-page-workflow/。
- 首次 native host 初始化实测较慢，测试的首次启动等待调整为 45 秒；后续动作与消息观察超时未因此放宽。
- 当前真实浏览器仍返回 boss-dom-readonly-0.1.1；新版已构建在 dist/boss-extension，待用户刷新至 0.2.0 后重新连接。
- 真实搜索、真实沟通、真实循环：本版本均尚未验收；没有发送消息。下一步仅运行 extension search-test。

以下为历史检查记录。

日期：2026-10-28。

- 原有基线：74 项 Vitest 测试通过。
- 新增验证：Native 帧分片/粘连/非法输入，认证与会话检查，单实例与发现文件，生命周期绑定，最小 DOM 读取，重复请求/断连日志，实际 Python 进程 + MCP SDK + 模拟 native peer，注册/卸载。
- 本地全量验证（审查修复后）：18 个 Vitest 文件、83 项测试通过；14 项 Python unittest 通过。TypeScript typecheck/build 与扩展构建通过。Python 依赖有已知弃用提示，未因此更换依赖版本。
- 独立审查：3 个重要问题均先复现再修复——导航后重新绑定、旧连接断开回调、晚到事件归属与实际执行边界摘要。工具输入/输出 schema 的握手比对作为次要项延后，发送前需要补齐。
- 安装：本项目 HKCU native host 已注册；注册/精确卸载使用临时注册项测试通过。
- CLI 实测：未连接扩展时返回 HOST_NOT_CONNECTED，落盘 doctor.json；没有将此状态误报为网页读取失败。
- 真实 Chrome：扩展 0.1.0 已连接用户打开的 BOSS 职位页。runId a20fd8ea-0a9a-448c-b308-7a275c87a288，10/10 次读取通过，用时 60765 ms；每次识别 1 个搜索框、15 个稳定职位。所有请求 observed，最后确认边界 dom_read_complete；本次没有记录到导航/标签关闭事件。
- 真实搜索、打招呼：未实施、未发送。当前代码没有开放写工具。
- 账号核验：0.1.0 尚未实现账号标识检查，不能据 unavailable 断言网站没有稳定 ID。0.1.1 增加限于可见账号区域的只读证据：候选 data-user-id/data-geek-id/data-account-id 在浏览器内哈希后传回；不读取 Cookie/页面内部认证状态，不把姓名当作唯一 ID。真实 runId 04816712-606a-459f-b8d9-81e1208377c1 两次读取通过：headerCount=1，hashAvailable=true，nameHash 一致，candidates=[]。这只能证明本次检查的三类属性未提供候选值，不证明所有网页路径都无账号 ID。
- 2026-10-29 用户已决定：不做账号识别，使用普通 Chrome 已登录并连接的页面。CLI 不再要求账号 ID 或本机绑定；发送工具仍未开放，下一阶段是实现并验证搜索与返回。
- 0.1.1 本地验证：19 个 Vitest 文件、85 项测试通过，类型检查和构建通过；新增账号区域最小读取/哈希隐私测试及异步内容脚本响应测试。

本地测试不证明网页端兼容性，不证明先前页面异常根因已经消失。

2026-10-29 当前页面模式复验：类型检查与构建通过；runId fdc98938-91d6-4800-a180-43be8b2e4dee，2/2 次真实只读检查通过，耗时 1446 ms，每次 1 个搜索框、15 个职位。报告 accountMode=current_connected_page、identityRequired=false、readStable=true、writeEnabled=false。未重新登录、未重装扩展、未搜索或发送。

## 2026-10-29：真实搜索测试与详情诊断

用户更新至 0.2.0 并连接后，运行 extension search-test。诊断 runId f5d2444a-82fd-48e9-8fe5-7fff658ba3e2：search_jobs observed，读取 15 个职位；open_job 在详情观察阶段返回 DETAIL_AMBIGUOUS:matches=0。contacted=0，confirmed=0；未发送消息。搜索可用，详情核验和返回仍未通过，不能宣称完整流程可用。

构建 0.2.1 增加限于职位页固定公共锚点的只读 layoutProbe：仅标签、类名、有限祖先/子节点结构，不读取 HTML、任意属性、链接参数、账号或聊天正文。doctor 将每次只读样本保存为 sample-N.json。目的为取得真实结构证据；没有猜测修改详情选择器。新增回归先失败后通过，DOM/search 两文件 6 项通过；typecheck/build/extension build 通过，扩展 ID 和权限保持不变。待用户刷新 0.2.1 并重连后执行只读诊断。

## 2026-10-29：0.2.1 结构证据与 0.2.2 修正

只读 runId afb76982-5378-4e3c-8df8-98ad639ce004，两次成功；adapterVersion=boss-dom-0.2.1。真实 DOM 同时包含外层 job-detail-container 和内层 job-detail-box，详情已出现；15 个职位的原 company 选择器均读取为空。前次 matches=0 只能说明当次观察没有可见详情，不能解释为网站没有详情选择器，也不能断言浏览器崩溃。

0.2.2 修正：零详情改为 DETAIL_NOT_READY，交由现有有界观察循环等待；嵌套详情候选只保留最内层，两个独立详情仍拒绝。新增已知职位卡片/详情的有限结构元数据，供后续核对公司、标题、稳定职位关联，不读取账号或任意属性。回归先失败后通过。等待扩展加载新版本后继续真实搜索验收；尚无消息发送。

## 2026-10-29：0.2.2 真实验收与公司字段修正

只读 runId 2847b7a0-8a89-43a9-9fac-f9d9aca583c7，2/2 observed，adapterVersion boss-dom-0.2.2。结构证据显示：卡片公司位于 job-card-footer > boss-info > boss-name；详情内 more-job-btn 的 job_detail 链接包含与第一张卡片相同的职位编号，卡片没有 active/selected 类。

真实 search-test runId e7e1af21-6e3a-4a4d-a381-daafe142d59e：搜索 15 职位，详情容器/标题/编号核对已通过，停于 POSTCONDITION_TIMEOUT:DETAIL_COMPANY_UNPROVEN；contacted=0，confirmed=0。仍未验收返回。

0.2.3 按上述证据修正卡片公司读取；详情缺少独立公司节点时，仅在详情内编号链接与当前卡片编号/标题严格对应、卡片公司非空且与目标一致时使用该卡片公司。保持错编号、公司变更、空公司拒绝。复用 detailRoot 修正沟通准备阶段同一嵌套容器问题，但未执行真实沟通。新增测试均 RED→GREEN；DOM/search/greeting 12/12 通过，typecheck 和扩展构建通过。扩展 ID/权限保持不变。待刷新 0.2.3 重连后继续真实搜索验收。

## 2026-10-29：0.2.3 真实搜索验收通过

用户确认 0.2.3 已加载并连接后，运行 extension search-test，退出码 0。诊断 runId 1d222837-8697-4506-b04c-9f67475170cc，业务 runId 1ee1291f-d71d-4b49-ad7e-04e429c14593。search_jobs、open_job、restore_search 均 observed，最后边界均 dom_action_complete，无错误。读取 15 个职位，核对第一条详情后确认搜索列表恢复/保留；stopReason=SEARCH_VERIFIED。

本轮仅验收搜索、首条详情核对、搜索列表恢复。未执行 open_chat 或常用语操作，contacted=0、confirmed=0、uncertain=0；不据此宣称真实打招呼或批量循环已验收。当前人工发送模式保持不变。

## 2026-10-29：用户明确授权本次循环沟通

用户当前指令为“点击立即沟通，然后发送第一个常用语，然后回退到职位列表。重复这个流程”。本次授权涵盖当前 Chrome 已登录页面、深圳 AI应用开发工程师搜索结果、第一条既有常用语，不涵盖附件、电话/微信交换或其他承诺。按当前明确授权执行；保留 private/profile.json 的人工默认与历史额度记录，不启动计划任务。

0.3.0：按真实详情结构读取招聘者姓名，排除活跃状态子节点；新增聊天控件/编辑器结构的只读诊断，不采集聊天正文或草稿。CLI 增加显式 --retry-historical-quota，仅与本次 --confirm-send 配合，在当日重新检查已连接职位页后允许尝试早于当日的历史额度记录；不声称额度已恢复，不放行当天额度、项目停止或未决联系。授权仅存在本次进程，跨日失效，历史配置不改。quota-preflight.json 记录 availability=unknown_until_platform_action。

策略、搜索、DOM、常用语、循环 19 项相关测试通过（新增用例先 RED 后 GREEN）；typecheck/build/扩展构建通过。扩展 0.3.0 待加载；下一步先真实执行一次沟通/常用语/返回，确认送达后按本次授权继续串行，遇平台额度/验证/未知发送结果停止。当前尚未发送。

## 2026-10-29：首次真实沟通到达聊天页，常用语尚未发送

0.3.0 greet-once --confirm-send --retry-historical-quota 的诊断 runId bebed738-cf33-4d1b-9185-a0a96936f262，业务 runId b9d7dc87-aaac-44b8-985a-8895bacc3596。search_jobs/open_job 通过，open_chat 在点击后约 200 ms 检查旧职位页，CHAT_AMBIGUOUS:matches=0 提前终止。没有执行 read_first_phrase/choose_first_phrase/submit_filled_phrase。数据库保留 uncertain 联系记录，不能直接重新运行 batch 或删除记录以绕过未决状态。

用户确认当前已是聊天页并重连。只读 runId 095dab87-6836-44b9-b361-2abaa5b4cda3 的 sample-1.json 证明路径 /web/geek/chat，adapter boss-dom-0.3.0，存在 chat-conversation、top-info-content、message-content、btn-dict 常用语、chat-input、btn-send。doctor 因只接受职位页而报告 PAGE_NOT_READY:chat，不代表聊天页面失败。未读取到聊天抬头子结构或展开的常用语菜单。

0.3.1 修正：open_chat 在仍为原职位文档时等待导航，抵达聊天页后才观察；聊天区域零匹配为 CHAT_NOT_READY，多个独立目标仍拒绝。新增测试复现了 500 ms 延迟导航先前 200 ms 失败，修正后仅点击一次并成功观察。增加已知聊天抬头文本及菜单/消息区域结构诊断，后两者不返回正文或草稿。尚需据真实头部/菜单证据实现安全续接已有未决聊天；不要重新点击同一立即沟通，也不要宣称恢复发送入口已完成。

## 2026-10-29：0.3.2 恢复入口与返回导航修正，真实发送仍未完成

只读样本 8ac3858a-2bc8-48f8-af01-8e414373b6d8 证明实际聊天抬头位于 top-info-content，职位 position-name、招聘者 name-text、公司 base-info 的直接 span。据此增加严格的公司/职位/招聘者匹配。

新增 resume-greeting：仅恢复原有 uncertain 且 phrase 为空、原诊断证明未选择/提交常用语的记录；保留其他未决联系与额度停止，核对原详情证据，重新打开时必须为“继续沟通”。允许从已绑定的原聊天页或职位页恢复；不会将恢复记录当作新联系或删除旧记录。

真实恢复 runId 96ad92b4-aaab-4736-b041-73a05466c1e0 在 restore_search 点击“职位”后，于原聊天文档检查搜索框，SEARCH_BOX_AMBIGUOUS:matches=0 提前结束；后续 doctor 返回 BOSS_TAB_NOT_BOUND。尚未执行任何常用语选择/提交。热加载 0.3.2 的方案因导航未完成而未得到验证，不能宣称已加载。

补充延迟返回导航回归，先复现失败再修正：仍在原聊天文档时等待，不重复点击，抵达职位文档后再读取搜索框。15 项导航/恢复/常用语/存储测试通过，typecheck、TypeScript 构建、扩展构建通过。后台改动必须刷新扩展并重连；已请求加载 0.3.2。真实常用语菜单选择、送达及完整返回仍待验收。

0.3.2 本轮最终全量 TypeScript 测试：27 个文件、117 项全部通过（83.66 秒）。此结果只证明本地测试通过，不代替真实发送验收。


## 2026-10-29：0.3.2 真实返回通过，0.3.3 直接续接当前会话

恢复 run 200060de-df25-4ac9-a715-efb54bd33bbd 的 restore_search observed，脚本版本确认 0.3.2；原星尚智能 key 不在当前 15 条搜索结果，open_job 报 JOB_NOT_VISIBLE。只读 run 1c1b78ef-0396-4d78-9c62-6c540ebb2c32 两次读取正常，证明导航等待修复生效且连接未丢失。

原 attempt b1ba53c6-029f-417a-a4c1-e9f51963e0ec 经原诊断与 phrase=NULL 审计，保留记录并标记 skipped，evidence=opened_without_phrase_send，不计发送成功，后续按 key 跳过。新增 skipAuditedUnsent 测试先 RED 后 GREEN；已 pinPhrase 的未知发送拒绝此处理。

下一条真实 greet-once run 775194b2-343e-45aa-9197-cc8db15eb0a9（业务 e9220e7d-d2a5-4e5a-bda3-450bf7fd86f7）已搜索、核对详情、点击进入湘凡科技彭女士聊天，停于 CHAT_AMBIGUOUS:matches=2。未选择或发送常用语。attempt=7bd3594f-9d13-4375-86ca-29681cf56517 保持 uncertain/phrase=NULL。只读 c40d9582-b40c-4d37-8176-9f4b84a875d2 确认当前聊天目标，连接正常。

0.3.3：聊天根节点只折叠互相包含的包装层，独立多个目标仍拒绝；inspect_chat 可只读建立当前会话状态，返回头部给恢复程序再次核对原详情证据。恢复当前聊天不再先返回列表找已沟通过的职位。首次 inspect_chat 重新注入固定本地 content.bundle.js，后续页面适配修改可由该入口加载（仍需真实验证）；无动态脚本/选择器或扩大主机权限。后台 state.chat 保存 inspected 结果。恢复入口继续要求原未发送审计，先匹配公司/标题/招聘者再读取常用语。

19 项导航/恢复/常用语/存储测试通过，typecheck、TypeScript/扩展构建通过。0.3.3 待用户刷新并连接当前湘凡科技会话；完整发送与返回仍未验收。下一次命令：extension resume-greeting --attempt 7bd3594f-9d13-4375-86ca-29681cf56517 --diagnostic-run 775194b2-343e-45aa-9197-cc8db15eb0a9 --confirm-send --retry-historical-quota。


## 2026-10-29：真实常用语发送与返回验收通过（0.3.9 页面适配器）

用户更新扩展 0.3.3 后，直接恢复当前湘凡科技会话。run dbde33b2-0d59-4d63-8f74-83ca7b6caf6c 已完成 inspect_chat 并打开常用语菜单，原选择器未匹配真实 sentence-panel/ul/li。只读样本 2f60b48d-ff80-40a4-b5d7-b55f5a3d8ea5 取得实际菜单结构，增加第一条 li 选择，回归 RED→GREEN。

0.3.4 已通过固定本地 content.bundle.js 重新注入自动加载，无需用户再次刷新。run dfcf35ea-08ef-4318-9fee-6077db6c978c 已点击第一条常用语，网页直接发送；旧 outgoing 读取了包含送达标签的 .text 外层，因正文前混入“送达”导致 SELECTION_NOT_OBSERVED。没有重放发送。样本 48f1ad71-67be-4635-b0f7-070b6365c114 证明 .text 内有 message-status 和独立 .text-content，修正为优先读取后者。

湘凡科技只读恢复核对 run 42cb17e1-88f3-4947-8ea6-2399dc2e8def：读取原 inspect_chat baseline=0、原 read_first_phrase 原文/hash 与数据库 pinPhrase 一致；新 inspect_chat 核对原公司、职位、招聘者、conversationKey 相同，新己方消息恰好一条与原文完全相等且状态“送达”。据此将 attempt 7bd3594f-9d13-4375-86ca-29681cf56517 标记 confirmed，sendReplayed=false。随后的返回曾提前报搜索框未加载，但 doctor fcc24de6-5766-4781-8959-a58c40d8057c 两次确认已回职位页、15 条职位、连接正常。

民信惠集团：初次 open_chat 观察到过渡头部导致目标不匹配；当前头部确认后，恢复 run 7795e2db-ae3f-4219-9ae2-f5292e482201 已连续执行 inspect_chat/read_first_phrase/choose_first_phrase/inspect_send_result 并 confirmed。返回遇初始城市加载问题，后续回列表已确认。无需重发。

页面适配修正：搜索框/城市尚未呈现时作为等待；返回观察阶段城市尚为默认值时等待深圳，准备/点击阶段仍拒绝非深圳；已匹配关键词和城市的结果复用，不再次搜索刷新旧卡片；open_chat 观察阶段头部尚未匹配时最多等待原 15 秒，发送前身份核对不放宽。各项回归先 RED 后 GREEN。最新本地包版本 0.3.9；Chrome 后台仍为用户加载的 0.3.3，固定注入已验证可以加载最新页面适配器，无需刷新后台。

两条猎头会话（某电子商务公司/夏先生、深圳某小型跨境电商公司/刘先生）在聊天页隐藏公司、标题增加猎头后缀，严格匹配失败，均未执行 read_first_phrase 或 choose_first_phrase。经原 native 审计与 phrase=NULL 核实后保留为 skipped，不计发送成功；猎头版式仍未适配，批量流程遇新类似版式可能停止，不能宣称全站连续跑满额度已验收。

最终独立 greet-once 真实测试 run 2bd574c6-0ead-410d-8619-3840a471cbae（业务 69e68130-574b-425f-b8dc-6644e5ffb3d6）退出码 0：平安银行 AI 应用开发工程师，search_jobs → open_job → open_chat → read_first_phrase → choose_first_phrase → inspect_send_result → restore_search 全部 observed。confirmed=1、uncertain=0，CONTACT_LIMIT 是本次 maxContacts=1 的正常结束，非平台额度用尽。全程无用户插入操作、无发送重试。最终已回深圳 AI应用开发工程师列表。

本轮真实发送累计确认 3 条：湘凡科技、民信惠集团、平安银行。星尚智能及两条猎头记录保留为未发送 skipped。未发送附件/联系方式，未启动定时或无限后台循环。private/profile.json 的默认人工模式和历史额度未改。

Final verification: 5 focused TypeScript test files, 29/29 passed (21.85s); typecheck and build passed. Real standalone send-and-return success is separately evidenced by run 2bd574c6-0ead-410d-8619-3840a471cbae.


## 2026-10-29：用户授权新的 20 条批次，第一条仍发送中

batch --max-contacts 20 --confirm-send --retry-historical-quota 在用户重新连接后启动，diagnostic 233e5193-7e64-4a7d-b99a-70f99864a629。第一条矩阵起源/马女士已点击第一条常用语，选择结果 submitted，inspect_send_result 最多等待后为 pending。业务 run e91dfc5e-869e-4344-8d40-ca7dc2c783f6 confirmed=0、uncertain=1；attempt f5a14e0a-4c4d-43a0-b511-8b1042fe9ed3 保留未决。

只读核对原文一致，状态文字为空；结构诊断 0097d76d-7d13-4a5a-8c42-bb01cc535cff 显示 message-status/status-loading。等待 30 秒后再次只读核对与 ff93febc-7b9b-4cc1-9a8f-ce8774e8fa79 结构检查，仍未送达。没有重发、清理未决记录、刷新页面或继续下一条。该批次 1 条触发发送、0 条确认送达、19 条尚未尝试，与之前测试 3 条成功分开统计。具体网络或服务原因未确认，不把发送中说成失败或成功。


## 2026-10-29：用户改为失败继续、50 条，并要求不复查旧消息

用户明确指示失败继续下一位、任务改为 50 条，随后指示直接从已连接职位列表开始、不核对上一条。上一条矩阵起源 attempt f5a14e0a-4c4d-43a0-b511-8b1042fe9ed3 保留原文和原记录，按新授权改为 deferred/pending，不算成功/失败、不重复发送。本轮总目标 50 次消息尝试，旧 1 次占 1，新增最多 49 次；此前测试的 3 条成功不算入本轮。

新增 CLI 明示选项 --continue-on-send-failure、--continue-on-pending-send，默认仍不放行未确认发送。DOM 区分 failed/pending/confirmed；failed 仅取明确失败文字。工作流对 pending 最多额外只读检查两次（各隔 1 秒），新授权模式下记录 deferred 后返回列表继续，失败记录 failed，均永久保留去重。成功/失败/待确认分别计数；平台限额/验证/登录等全局错误仍停止。store 不把明确 failed 或用户授权 deferred 当作全局未决阻塞。

未发送的猎头会话 run 6b90291b-54d5-4640-9596-aadcf5820b0d 经原审计/phraseNULL 保留 skipped。增加显式可见“猎头”徽标识别，在打开聊天前跳过当前不支持版式；并仅在详情观察阶段等待旧详情切换，发送前身份核对保持严格。页面适配器 0.3.11 已通过现有固定脚本注入加载，无需刷新扩展。相关 RED→GREEN 回归已覆盖失败不重发继续、pending 独立计数、50 次上限、猎头卡片跳过、详情等待；17 项搜索/批次测试通过，前一组19项批次/发送/存储测试通过，TypeScript build通过。

运行中批次 diagnostic run 39ac76ba-0628-4677-9492-1d803c191c87，maxContacts=49；任务清单见 private/boss-extension/batch-50-current.json。尚未宣称完成 50 条，最终以记录汇总为准。


2026-10-29 ongoing batch: 35 focused tests passed; a live FIRST_PHRASE_CHANGED revealed temporary default phrase before the saved phrase loaded (native run 11ebd72c-4ab8-460f-8613-4aae4391ed2a). A later read of the same chat returned the original saved phrase/hash. Added read-only bounded polling against the pinned hash before clicking; regression RED then GREEN, batch tests 9/9 passed and build passed. Per-contact unsupported chat skips require native last-open-chat scoped audit, no later phrase-selection/submission, phrase NULL, and observed detail key matching the database record. Prior sends in the same batch are never replayed. Execution progress is kept privately in private/boss-extension/batch-50-current.json; counts pending are not delivery claims.


2026-10-29 batch completed: native audit across the 10 listed runs confirms exactly 50 unique choose_first_phrase requests; SQLite records 40 confirmed, 10 deferred/pending, 0 failed, 7 unique unsent skips in these runs. The initial pending contact is included in 50; earlier three test deliveries are excluded. Last run 430b79ac-7fae-472e-a80e-d9ea0634a103 (business 76c02524-c048-4328-a7a7-59288d288977) ended CONTACT_LIMIT after one confirmed send and observed restore_search. Final state is jobs list; no process left running or schedule created. Pending messages were not replayed or relabeled as delivered. Task state: private/boss-extension/batch-50-current.json.


2026-10-29 second 50 batch: native audit verifies 48 actual phrase selections and SQLite 48 confirmed deliveries, 0 pending/failed. One choose request rejected FIRST_PHRASE_CHANGED before click (8d5daaaf-4c80-4e61-a32a-d32e352e6985) is explicitly excluded; empty outgoing baseline/current chat and source guard proved no send. Before first pin, saved phrase now requires stable reads; 10 batch tests passed. Two later open_chat calls stayed on jobs. New read-only notice probe bc435fcc-1a24-46f9-a399-e235cb9fede4 revealed chat-block-dialog: today 120 BOSS contacted, 30 chances remaining, button 好. Not a quota exhaustion. 0.3.13 adds strictly scoped acknowledgement of positive remaining-count notices; 11 greeting tests passed, 5 DOM tests passed, build passed. Live verification of this acknowledgement remains pending: subsequent connect returned BOSS_TAB_NOT_BOUND. No new send after 48. User asked to reconnect, 2 remain. State: private/boss-extension/batch-50-second.json.


Second batch completed after user reconnected: 50 actual first-saved-phrase selections, 50 confirmed deliveries, zero failed/pending/unresolved sends. One before-click rejected request is excluded. Last native run e1a13fcc-0d57-45d2-971b-db9447db4409, business 78c896c1-b872-4ea1-9187-cfdf0f7ae3b3, confirmed 2 with observed restore_search and normal CONTACT_LIMIT. Final page jobs, task stopped. Audit stored in private/boss-extension/batch-50-second.json. Previous batch remains separate (40 confirmed, 10 pending).


2026-10-30 user requested every search-result job, without position/company/headhunter filtering. Built extension content 0.3.14: batch no longer skips unsupportedChat/headhunter badges; chat readiness requires a visible job header and the clicked recruiter, but ignores cross-page title/company equality. Current-chat inspection permits omitted company. Deduplication and platform/lease controls remain. Regressions RED→GREEN; 33 tests across batch, greeting, search, store passed; build and extension bundle passed. Read-only live verification attempted, but BOSS_TAB_NOT_BOUND: no browser action or new send in this change. Existing 00faaf13-802f-4109-bfbe-bcb944ca8165 run has 3 delivered and one unsent unresolved headhunter contact; retain it for scoped recovery after rebind, do not blindly rerun a new 50 batch or clear history.

2026-10-30 UNRESOLVED_CONTACT repair: workflow now tracks phrase-send dispatch per contact. Exceptions before any choose_first_phrase/submit_filled_phrase dispatch mark the attempt skipped (before_phrase_send), avoiding a false unresolved startup blocker; exceptions after dispatch remain uncertain to prevent duplicate sends. Dispatch tracking resets for each contact. New regression tests reproduced two failures before the fix, then 36 focused tests across batch/greeting/search/store passed; TypeScript build and typecheck passed. Native errors still terminate the current lease/run; this change does not claim automatic same-run recovery.
Scoped historical repair: native run 00faaf13-802f-4109-bfbe-bcb944ca8165, attempt d1bd389a-b3a0-42c8-8855-37b18da55248. Audited last open_chat and all following events (no phrase send), matched the persisted observed open_job key to the attempt, verified phrase NULL and CHAT_TARGET_NOT_READY. Changed only this unsent attempt from uncertain to skipped; retained original diagnostic summary and added private unsent-recovery.json. Same business run now has 3 confirmed and 1 skipped, getBlockers() empty. Live read-only inspect observed jobs page with no page blockers. No new messages sent. This runner-only fix requires no extension reload.

2026-10-30 DETAIL_NOT_READY timeout fixed (native run c3194a8a-67b4-4ad5-9d11-9e8d425380d8; business eb011ea7-89ce-47ef-86a0-2a9613afe37d). 19 confirmed sends preceded open_job timeout; no twentieth chat/send. Live search-only reproduction: job b15c5a0d918c3c210nd_0ty6F1ZU (品阔) has list title AI应用开发工程师, detail title AI应用开发工程师（驻马来西亚）, identical stable detail job URL. Version 0.3.15 diagnostic probe demonstrated loaded detail; old exact-title guard still timed out after 15 seconds. This was identity validation, not slow networking.
Version 0.3.16 uses explicit matching detail job key as authoritative and requires title equality only when no explicit key exists. Wrong keys and ambiguous details remain rejected. Added bounded read-only detailProbe (public title/company/job keys only, no query strings/descriptions/chat). Regression failed DETAIL_JOB_MISMATCH before fix, then full suite 27 files / 142 tests passed. Typecheck, TypeScript build, extension bundle passed. Same live Chrome document loaded 0.3.16 through existing search-only adoption and successfully completed open_job for the exact formerly failing key, recruiter 陈先生. Stayed on jobs; no new messages. Recovery CLI expected adapter version updated. No extension reload required for current connected document.

2026-10-30 new user-authorized 100 batch ended: native audit confirms exactly 100 observed/submitted choose_first_phrase requests across nine sending/attempt runs; business database 95 confirmed, 5 deferred (four pending receipts plus one submitted action whose later receipt became unknown), 4 pre-send skips. Last run a150e162-4287-42a4-b3d8-2daff27e1785 completed CONTACT_LIMIT and observed restore_search. No running sender left. Excludes earlier 19/user-run batches. State private/boss-extension/batch-100-20261030.json.
Content exception must be disclosed: 99 selections used the saved custom phrase hash 5dfca584eecc4837c6723db3bc448c59ac77b19233e6401c4010b89b4dc50de0; one confirmed selection in 3451a677-5da6-4387-a368-7d3eb8662592 used the temporarily displayed default first phrase “我可以把我的简历发给您看看吗？”. Stable-read protection alone did not prevent default pinning after a restart. The following contact failed FIRST_PHRASE_CHANGED before send and was skipped. No extra/repeated message sent to mask this error. Future work needs persistent phrase expectation across continuation runs or explicit default-loading protection.

2026-11-01 DETAIL_NOT_READY during open_chat preparation (native 9be185f7-7591-49a4-aed0-33655747a0f1, business eaf1d504-563b-4706-b7f9-6ebeb6af0928): audited last successful open_job 97150749-ed33-4c58-bc54-c76b6140c391 for 深德科 / key 8d27de1bc01265940nJ52tq6FVBZ. Next open_chat 8f6a885a-7b53-47c8-b5b7-49fbd73a5235 failed at initial prepare in about 127 ms, with only one content dispatch and no phrase selection. Live page later had a different detail (信锐技术 / cb60358e71fa32c50nJ83Nu9E1BZ), consistent with an in-page rerender/replacement; no evidence of browser connection failure.
0.3.17 fixes read-only open_chat preparation: wait up to four seconds, bounded by command deadline, for matching detail identity. A missing/replaced detail that cannot recover returns unavailable before authorization/click; workflow records a no-send skip, restores the list, and continues in the same lease. Ambiguity, quota, login, verification and other errors remain blocking. Communication click is never retried. The existing maxContacts attempt budget still includes these skips.
Three regression cases failed before fix (temporary missing root; persistent replacement must not click; batch must continue without reading a phrase for the skipped contact). After fix, 28 targeted and full 27 files / 145 tests passed. TypeScript build, typecheck and extension bundle passed. Existing Chrome received content 0.3.17 via search-only adoption; search and open_job passed, final page jobs. No live messages sent during repair. Original database remains 23 confirmed + 1 pre-send skipped, startup blockers empty. This does not resolve the separately documented default-phrase loading issue.

2026-11-01 JOB_NOT_VISIBLE recovery (native failure 0e1fbedb-c9a6-4f88-952f-a9daa623cad7, business 91f7b881-0dfc-4b8c-a48b-356518275bc3): restore_search observed 15 jobs at 10:05:25 UTC; open_job failed at prepare about two seconds later because the selected key was no longer in the list. No communication or phrase action for that missing job. Version 0.3.18 returns observed unavailable for missing cards at prepare or after click authorization; no replacement card is clicked. Batch skips the old key, rereads list_jobs without advancing, and rebuilds traversal before reserving a contact, so missing cards do not consume maxContacts. Search-only reports JOB_LIST_CHANGED instead of falsely claiming detail verification. Quota/login/verification/ambiguity checks and delivery uncertainty handling remain unchanged.
Three new regressions reproduced failures before fix. Focused 27 tests passed; full 27 files / 148 tests passed, TypeScript build/typecheck and extension bundle passed. Live search-only run ae3a2395-a42b-4145-b35e-20eb8e95e795 loaded content boss-dom-0.3.18 in the existing Chrome document. A historically observed but now absent key 22cf4e89d329b0f50nNz09S_FlBQ returned unavailable/JOB_NOT_VISIBLE; the same lease then reread jobs and successfully opened cb60358e71fa32c50nJ83Nu9E1BZ, followed by restore_search. Final page jobs. Evidence: private/boss-extension/job-list-recovery-verification.json. Original business run still has 24 confirmed and no unresolved contact. No live messages sent during repair; no extension/background reload required for the current connected document. Separately documented default-phrase loading issue remains outside this fix.
