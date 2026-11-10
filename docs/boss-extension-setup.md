# BOSS 页面操作扩展：0.2.0

已实现当前页面工作流代码：搜索与返回、单次沟通、串行循环。真实网页搜索和沟通仍需按阶段验收，不能用模拟测试代替。它沿用 mcp-bosszp 的 Python/FastMCP 方向，但已重写执行层，不使用上游登录、Cookie 或私有请求接口。

## 更新与运行

在 chrome://extensions 的“BOSS 页面诊断”卡片点击圆形刷新按钮，版本应变为 0.2.0。然后回到原来已登录的 BOSS 职位页，在扩展中点击“连接此页面”。无需重新安装、登录或创建浏览器。更新会让 Chrome 启动新版项目 native host；首次导入依赖可能需要数十秒。不要在仍显示“正在连接”时反复启动。

```powershell
# 搜索固定关键词、查看一条详情、恢复结果列表；不调用联系工具
.\scripts\boss.cmd extension search-test

# 以下属于实际发送，仅在用户授权且历史额度/未决结果已处理后使用
.\scripts\boss.cmd extension greet-once --confirm-send
.\scripts\boss.cmd extension batch --max-contacts 10 --confirm-send
```

所有命令沿用当前已连接页面，不读取账号 ID、不区分不同登录账号；去重以本项目历史为准，切换账号不会清空记录。新业务表 page_runs/page_attempts/page_stops 位于 data/boss.sqlite；首次遇旧业务库会备份再新增表。

未指定 --confirm-send 时联系流程报 SEND_AUTHORIZATION_REQUIRED。现有历史额度记录会报 HISTORICAL_QUOTA_UNVERIFIED 或 LEGACY_QUOTA_STOP，不会因过了一天自动解除。UNRESOLVED_CONTACT 表示可能已联系，先核对结果，不能重新点一次试试。

连接后不会自动执行。运行期间不必保持弹窗打开；“停止并断开”或终端 Ctrl+C 停止后续动作，已发送的消息无法撤回。额度提示、验证码、登录失效、目标不匹配、结果未知都会停止流程。

## 构建与安装

在项目根目录执行：

```powershell
.\scripts\boss.cmd build
& "$env:USERPROFILE/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe" scripts/build-boss-extension.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/register-boss-bridge.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/register-boss-bridge.ps1 -Apply
```

第一条注册命令只预览，带 `-Apply` 才写入当前用户 HKCU 的 `com.jobsearch.boss_bridge` 注册项。这里的执行策略仅作用于此 PowerShell 子进程。依赖使用项目 `.venv-mcp-bosszp`，不安装到全局 Python。来源及锁定依赖在 integrations/mcp-bosszp/。

1. 在已登录 BOSS 的普通 Chrome 中打开 `chrome://extensions`，开启“开发者模式”。
2. 点击左上方“加载未打包的扩展程序”（其他版本可能叫“加载已解压的扩展程序”），选择 `D:\code\job-search-skills\dist\boss-extension`。
3. 选中原来的 BOSS 职位页，打开扩展“BOSS 页面诊断”，点击“连接此页面”。保留该标签。

预期扩展 ID：`ncgfofdicoadoeifjlpageijconkijic`。如果 ID 不同，不更改允许列表迁就未知扩展；先检查是否加载正确目录。这个扩展使用 [Chrome Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging)，不会出现 Playwright Welcome 页。

## 检查与证据

```powershell
.\scripts\boss.cmd extension doctor --samples 10 --duration-ms 60000
```

诊断输出在 `private/boss-extension/diagnostics/<runId>/`：doctor.json、events.jsonl、summary.json。本地连接凭证在 discovery.json，仅当前用户可读，**不要复制或发给任何人**。host-stderr.log 记录服务启动异常；扩展的“查看连接记录”保留断连后的事件。

判读示例：

| 结果 | 意义与下一步 |
|---|---|
| HOST_NOT_CONNECTED | 本地服务尚未启动：检查扩展是否加载、是否点“连接此页面” |
| Specified native messaging host not found | 检查当前用户注册项、清单路径与扩展 ID |
| HOST_HANDSHAKE_FAILED | 发现文件过期或服务停止：扩展断开后重新连接，浏览器页保持原样 |
| DOCUMENT_CHANGED / BINDING_CHANGED | 标签文档已变化：停止并保留日志，不能继续用旧元素 |
| CONTENT_CHANNEL_FAILED | 标签已绑定但内容脚本没有回应：查看扩展连接记录和日志中的最后阶段 |
| searchBoxes=0 或大于 1 | 候选选择器不符合真实页面，需要根据当前 DOM 修订，不能盲点 |
| accountMode=current_connected_page | 使用用户在 Chrome 中登录并连接的页面，不要求账号 ID；仍校验标签、文档和页面状态 |

只读候选选择器只采集可见职位卡片的小范围字段，不读取聊天正文；第一阶段还不能认证真实站点的发送契约。仅看到 `readStable=true` 也不意味着允许发送。现有数据、人工发送默认及额度停止记录不改变。

## 停止与卸载

扩展“停止并断开”结束自有服务，保留浏览器/标签；Ctrl+C 停止本次 doctor 检查，扩展可继续保持空闲连接。无定时任务或岗位后台轮询。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/unregister-boss-bridge.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/unregister-boss-bridge.ps1 -Apply
```

卸载只移除本项目注册键和 native host 清单；然后在 Chrome 扩展页手动移除“BOSS 页面诊断”。不会清理浏览器配置、私人材料或业务数据库。

### 当次新指令下检查历史额度

只有用户今天明确重新要求沟通时，才使用 `extension greet-once --confirm-send --retry-historical-quota`（先验证一条），或已授权的 `extension batch --max-contacts N --confirm-send --retry-historical-quota`。该参数不会修改历史记录、解除 SQLite 停止或宣称额度恢复；仅允许早于当天的 profile 历史记录在当次显式请求与新页面检查后尝试。当天额度、未知发送结果、验证或断连仍停止。扩展 0.3.0 应先加载并连接。
