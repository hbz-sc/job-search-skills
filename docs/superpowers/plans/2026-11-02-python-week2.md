# 第二周：最小 LangGraph 实施计划

沿用用户已确认的学习路线：TypedDict、State、Node、Edge、条件边。新增 learn-graph 命令，不改第一周 learn 和真实业务入口，不引入模型、浏览器、checkpoint 或 interrupt。

结构：python/jobpilot/week2.py 定义 LearningState、读取/筛选/标记待补充/报告节点、路由函数和 CLI。复用 week1.read_jobs/filter_jobs，单独输出 output/jobpilot/week2。正文缺失仅对符合城市条件的去重后岗位判断；未知城市保持第一周 needs_info 分类。

流程：START → load_jobs → filter_jobs → [缺正文: mark_missing → save_report；齐全: save_report] → END。读取/校验失败直接 END，CLI 返回1、不生成成功报告；写入失败由CLI报告。

- [x] 先写CLI行为测试并观察失败：两条分支、错误、空列表、城市未知、无需模型网络、完整状态报告。
- [x] 实现图与CLI；每个节点返回局部状态更新，路由函数只决定下一节点。
- [x] 写逐模块解释与练习；运行全套Python测试和真实CLI样例。
- [x] 独立审查并记录验证结果。

目录无Git元数据，原地增量修改，不提交；不更改私人资料和真实投递历史。

验证：新增4项测试先因learn-graph命令不存在失败；实现后Python全套30项通过。真实CLI执行默认样例经过4节点/needs_info，旧样例经过3节点/completed；boss.cmd转交帮助退出0。人工读取两份Markdown报告确认分类与轨迹正确。

独立代码审查无重要问题，另行运行4项第二周测试通过。文档由主代理校验（审查时尚未生成）。
Final: minor (deferred): 后续增加缺文件、非法JSON、报告写入失败三类专项回归；目前路径依靠已有异常处理，未作为第二周独立用例覆盖。
