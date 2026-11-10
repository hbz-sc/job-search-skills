# 五分钟演示

1. 展示 examples/jobpilot 的虚构简历及两份岗位，说明数据来源和 initialDetailIds 的区别。
2. 运行 `scripts/boss.cmd jobpilot demo`，观察 stderr 节点进度，保存 stdout 的 batchId/threadId。
3. export 批次，查看推荐、证据、缺口和草稿；对比两个岗位 provenance.budget.toolAttempts。
4. 命令返回后进程已退出，执行 review revise，展示从审核节点恢复及草稿版本递增。
5. 再执行 approve；另一份岗位可 reject。解释两者均只记录审核，不联系招聘方。
6. 展示 `scripts/boss.cmd test tests/jobpilot/resume-process.test.ts tests/jobpilot/review-replay.test.ts`，说明恢复和重复审核有自动验证。

使用说明中的命令占位符需替换为本轮实际 ID；不要复制过期 ID。真实运行结果和评估记录位置见 acceptance.md。
# 新增搜索演示入口

真实模型规划及 Edge 搜索工作流的命令见 [搜索指南](search-greeting-guide.md)，当前可宣称的验证范围见 [验收记录](search-greeting-acceptance.md)。网页未连接时只演示规划与本地回归，不把模拟工具输出描述成真实沟通成功。

