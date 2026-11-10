# 来源与维护范围

参考 https://github.com/mucsbr/mcp-bosszp ，提交 df9ba573829ded5cdd05abcfe5f055fb89e0befa（MIT，bril，2025）。保留其 Python/FastMCP 方向，页面执行层为本项目重新实现；不导入上游扫码登录、Cookie、HTTP 私有接口或浏览器启动代码。不是原项目开箱即用。

本轮先实现设计第一阶段的只读通路，工具契约暂只开放 inspect_session 及诊断查询。写工具必须在真实页面能力验证后新增，不声明未实现的能力。
