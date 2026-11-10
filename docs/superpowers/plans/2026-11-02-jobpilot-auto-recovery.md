# JobPilot Auto Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans inline; one final fresh review.

**Goal:** 同一授权页面失效后自动重绑，在原批次预算内安全续跑。
**Architecture:** 扩展管理标签授权和文档代次；search service 管理有限恢复循环；业务SQLite持久化恢复次数，既有动作账本阻止副作用重放。
**Tech Stack:** 现有 Node24、TypeScript、LangGraph、SQLite、Edge扩展、Python桥；不升级依赖。
**Spec:** ../specs/2026-11-02-jobpilot-auto-recovery-design.md

## Global Constraints
- 不初始化Git，沿用已授权就地工作区；日志 .superpowers/sdd/2026-11-02-jobpilot-auto-recovery/。
- 只恢复同一已授权tabId、https://www.zhipin.com/web/geek/jobs或chat。
- 主动断开/关页/离开允许页面撤销授权；登录/验证阻止恢复；不增加扩展权限。
- 最多3次持久化自动续跑；原预算、话术、历史判重不改变；未知发送不重发。

## Review Focus
1. 等待注入时主动断开，迟到回调不得重新绑定。
2. 页面连续变化，旧documentId不得覆盖新绑定。
3. 发消息后丢响应，恢复不得重新choose/submit/open_chat。
4. 达到3次重启后仍不可扩额；恢复等待活跃时间不清零。
5. 旧客户端close/heartbeat与新绑定竞态，不得撤销新授权或继续旧租约。

## Task 1 — 扩展恢复
- [x] tests/boss-extension-auto-rebind.test.ts 写同页刷新、代次、断开、非授权页和3次失败测试，观察RED。
- [x] controller.js新增授权目标和recoverBinding；按执行记录采用有界就绪读取，无需额外background完成事件；停止旧租约后只发布新绑定。
- [x] 定向新旧controller/content测试GREEN；升级到0.4.1，无权限改变。

## Task 2 — 批次恢复
- [x] tests/jobpilot/search-auto-recovery.test.ts 写短暂绑定失效恢复、持久3次上限、明确停止不重试及发送未知不重试，RED。
- [x] search-store持久化恢复占用；search-service恢复外循环复用现有resume；search-effects只对可安全恢复的连接错误保留分类，不重放旧请求。
- [x] 测试等待活跃预算和重启预算不归零，定向GREEN。

## Task 3 — 交付验证
- [x] 类型检查、build、受影响及全量Vitest、Python、扩展构建；保存日志。
- [x] 一次独立审查本增量，重要问题RED/GREEN修复；更新学习与验收文档。
- [ ] 更新用户实际加载的D:/code/jobpilot-edge副本；明确一次性重载要求，实站无发送预览验收恢复。无法观察实站时写明边界，不把模拟通过说成实站通过。
