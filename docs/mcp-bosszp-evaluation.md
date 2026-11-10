# mcp-bosszp 验证记录（2026-10-27）

结论：MCP 协议连接通过，现有实现不满足本项目流程，暂不替换 TypeScript＋SQLite 主流程。没有完成线上登录或打招呼验证。

## 来源与运行环境

- 仓库：https://github.com/mucsbr/mcp-bosszp
- 本地：`upstream/mcp-bosszp`
- 检查提交：`df9ba573829ded5cdd05abcfe5f055fb89e0befa`
- 独立虚拟环境：`.venv-mcp-bosszp`，Python 3.12，FastMCP 固定为 README 声明的最低版本 2.13.0，其余依赖解析结果见 `private/mcp-bosszp-test/requirements.lock.txt`。
- 未修改第三方源码、全局 Python、浏览器配置或现有主流程。

## 实测范围

运行：`.venv-mcp-bosszp\Scripts\python.exe scripts/test-mcp-bosszp.py`

测试包装器加载真实第三方服务器，用 stdio 子进程进行 initialize、tools/list 和一次 get_recommend_jobs_tool(page=1) 调用。测试期间拦截所有 requests.Session 网络调用，没有启动登录、浏览器或发送工具。原项目默认入口是 streamable-http；此次不宣称已验证它的默认 HTTP 部署。

结果：

- initialize 成功。
- tools/list 成功，返回 5 个工具。
- 推荐职位工具返回“未登录，请先完成登录再获取职位信息”。
- 未对 BOSS 发出业务 HTTP 请求，未发送招呼，未获取实际职位列表。
- 子进程结束；第二次验证退出码 0，无异常栈，仅依赖弃用提示。
- 第一次测试包装器退出时曾因 Windows 当前目录占用导致临时目录清理异常；已修正退出前恢复工作目录，并重新运行验证。该问题不是上游 MCP 业务错误。

机器可读结果：`private/mcp-bosszp-test/result.json`。

## 能力差距（实测工具 schema＋源码）

| 用户要求 | 当前实现 |
|---|---|
| 使用已经登录并打开的 Chrome | 自有 requests.Session 与扫码登录；没有连接现有 Chrome 的实现 |
| 搜索 AI应用开发工程师 | get_recommend_jobs_tool 仅有 page、experience、job_type、salary；调用推荐列表接口，无 query/keyword 参数 |
| 读取并发送第一条常用语 | 没有常用语读取工具；send_greeting_tool 声明的 message 参数未被使用 |
| 判断消息确实发送 | greet_boss 仅调用 friend/add.json，并根据接口 code 判断成功，没有聊天消息发送/送达核对 |
| 列表职位直接传给打招呼 | 推荐列表映射未保留 jobId/encryptJobId，而发送工具要求 job_id，链路还需补齐 |

主要源码定位：`boss_zhipin_fastmcp_v2.py` 的 get_job_list（约 534 行）、greet_boss（615 行）、get_recommend_jobs_tool（1159 行）、send_greeting_tool（1220 行）。

额外实现问题：登录验证使用固定 security-check 参数；登录流程打印部分 Cookie，登录信息工具返回完整 Cookie。这些代码未执行。若将来用于真实登录，需先处理认证和凭证输出，不应直接启用原始自动登录工具。

## 决策

此项目可作为接口研究参考，不能视作已可用的替代品。若采用它，需要新增登录适配、关键词搜索、职位 ID 保留、常用语读取与消息发送、发送后核对，并接回 SQLite 去重和停止条件。接入 MCP 本身不解决这些缺失能力。

当前不要求用户再次扫码，也不继续产生 Playwright Welcome 授权页；已有浏览器页面保持原状。
