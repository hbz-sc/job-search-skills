# 搜索页面观察与验收边界

2026-11-02，Edge 登录后已读到深圳职位页、搜索框“搜索职位、公司”、筛选项“工作经验”，以及实际岗位卡片中的 `li` 文本“1-3年”。经验触发器实际结构为 `<div class="current-select"><span class="placeholder-text">工作经验</span></div>`。

继续读取父级选项和操作经验菜单时，浏览器连接反复出现标签不属于当前会话、选择器超时、Debugger unattached。尚未获得完整经验下拉选项/选中状态的实站证据。

本地 fixture 的选项父级是合成结构，不是实站快照。适配器仅在可见 `.current-select` 唯一匹配且选中正文精确等于目标档时接受筛选；同时核对实际卡片经验。菜单找不到、仍显示“工作经验”、多选摘要或结果不匹配均停止。该实现通过模拟不等于实站验证通过，实际菜单布局仍须在连接恢复后核验。

2026-11-02 11:38 CST 更新：通过项目扩展只读 experienceProbe 获得真实结构：`.condition-filter-select > .current-select > .placeholder-text`，同父节点包含 `.filter-select-dropdown > ul > li`，各 li 的直接文本包括“1-3年”“3-5年”，并包含空的 `i.ui-icon-check` 子节点。菜单关闭时 dropdown/ul/li 可见标志为 false。旧代码排除所有有子节点的选项，导致无法点击这些 li；已建立此结构的回归并修正点击定位。选中后的标记和真实查询结果仍待下一轮观察，不能据此宣布两档筛选已通过。

真实刷新恢复证据：同 tabId 698267965 于03:38:31.399902 UTC记录document_changed，03:38:32.214531 UTC记录extension_bound，间隔约0.815秒；用户确认仅刷新、未再点击连接。刷新后的inspect读取到boss-dom-0.4.2，1个搜索框、无登录/验证码blocker。完整只读证据见 `.superpowers/sdd/2026-11-02-jobpilot-auto-recovery/live-after-refresh.json`。
