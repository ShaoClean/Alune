# GitLens 风格 UI 重构 TODO

> 目标：参考 GitLens 在 VS Code 中的「侧栏导航 + 仓库工作区 + Git 信息密度」设计思路，重构 RemoteGit Web 前端。
>
> 当前基线：`11931b4 feat: add AI gateway integration`
>
> 原则：保留现有 Git / SSH / AI Gateway 能力，优先重做前端信息架构、视觉层级和交互反馈；本文件完成前不开始大规模 UI 改动。

## 0. 基线盘点与约束

- [ ] 盘点现有路由、页面、组件和 Zustand 数据流
- [ ] 盘点现有 API 能力：连接、仓库、status、diff、log、branch、stash、remote、AI Gateway
- [ ] 确认 Git 状态数据结构，统一 staged / unstaged / untracked / renamed 等状态映射
- [ ] 确认当前项目的启动、构建和测试命令
- [ ] 保留现有后端接口和业务行为，UI 重构不改变 API 契约
- [ ] 保留当前 AI Gateway 页面能力，后续仅统一其视觉语言

## 1. 信息架构与页面骨架

### 1.1 全局应用壳层

- [ ] 将当前 Ant Design 默认 Layout 调整为 GitLens 风格的深色应用壳层
- [ ] 设计左侧窄图标栏：连接、仓库、AI Gateway、设置/帮助入口
- [ ] 设计可展开的二级导航区：连接列表、仓库列表和仓库分组
- [ ] 增加顶部工作区栏：当前仓库、当前分支、同步状态、刷新和更多操作
- [ ] 增加底部状态栏：连接状态、当前路径、最后刷新时间
- [ ] 统一桌面端最小宽度和窄屏降级策略

### 1.2 路由与上下文

- [ ] 保持现有路由可用：Connections、Repositories、Repository Detail、AI Gateway
- [ ] 让仓库详情页成为主要工作区，不再依赖单一的 Tabs 平铺所有功能
- [ ] 建立当前连接 / 当前仓库 / 当前分支的上下文展示
- [ ] 增加空状态、加载状态、错误状态和连接失效状态的页面级承载

## 2. 视觉系统与基础组件

### 2.1 设计令牌

- [ ] 定义 GitLens 风格色板：深色导航、浅色内容区、蓝色主动作、状态色和 diff 色
- [ ] 定义字体、字号、字重、行高、间距、圆角、边框和阴影令牌
- [ ] 定义文件状态、分支类型、同步状态、连接状态的统一颜色规则
- [ ] 移除当前散落的 inline style，集中到 CSS 变量和组件样式
- [ ] 调整 Ant Design ConfigProvider，使默认控件与新视觉系统一致

### 2.2 基础组件

- [ ] `AppShell`：全局应用框架和响应式布局
- [ ] `ActivityBar`：左侧主导航
- [ ] `RepositoryTree`：连接 / 仓库 / 分组树
- [ ] `WorkspaceHeader`：仓库、分支、同步和操作入口
- [ ] `PanelHeader`：面板标题、数量徽标、筛选和动作
- [ ] `StatusBadge`：统一显示 Git 状态和连接状态
- [ ] `FileIcon`：按扩展名显示文件类型图标
- [ ] `EmptyState`、`LoadingState`、`ErrorState`：统一反馈组件
- [ ] `CommandButton` / `IconButton`：统一按钮密度、Tooltip 和危险操作样式

## 3. Connections / Repositories 页面

### 3.1 Connections

- [ ] 将连接列表改为 GitLens 风格的资源树 / 卡片混合布局
- [ ] 突出在线、离线、连接中和认证失败等状态
- [ ] 将新增、编辑、删除、测试连接动作收敛到清晰的上下文操作
- [ ] 优化连接表单的字段分组、校验、密码/密钥提示和错误反馈
- [ ] 增加连接为空时的引导状态

### 3.2 Repositories

- [ ] 将仓库列表改为可扫描、可搜索、可分组的资源列表
- [ ] 展示仓库路径、当前分支、变更数量和最近活动
- [ ] 增加仓库收藏/置顶视觉预留，但不在本轮实现持久化收藏
- [ ] 优化添加仓库、扫描仓库和删除仓库的确认流程
- [ ] 点击仓库后保持全局上下文并进入 Repository Detail 工作区

## 4. Repository Detail 工作台

### 4.1 工作区布局

- [ ] 用三栏布局替代当前单一 Tabs：资源导航 / 主内容 / 辅助详情
- [ ] 左栏展示仓库内部导航：Changes、Commits、Branches、Stashes、Remotes
- [ ] 中栏展示当前面板内容
- [ ] 右栏按需展示选中文件、提交或分支的详情
- [ ] 支持收起 / 展开辅助栏，窄屏时转为抽屉或覆盖层

### 4.2 仓库头部

- [ ] 展示仓库名、远程路径、当前分支和工作区状态
- [ ] 增加 Fetch、Pull、Push、Refresh 等高频操作入口
- [ ] 展示 ahead / behind、未提交文件数和最近同步时间
- [ ] 为危险操作提供二次确认，并统一成功 / 失败反馈

## 5. Changes / Source Control 面板

- [ ] 将 staged changes、unstaged changes、untracked files 改为分组文件树
- [ ] 每组增加数量、全选、全部暂存 / 全部取消暂存动作
- [ ] 文件行展示状态字母、文件图标、路径和行数变化摘要
- [ ] 支持文件级 stage、unstage、discard，并为 discard 增加确认
- [ ] 保留点击文件查看 diff 的能力，并让选中文件状态明显
- [ ] 将 commit message、description 和 Commit 操作整合成紧凑提交面板
- [ ] Commit 前明确展示将要提交的文件数量
- [ ] 增加 clean workspace 空状态

## 6. Diff Viewer

- [ ] 将当前纯 `pre` 文本 diff 升级为 GitLens 风格的文件级 diff 视图
- [ ] 支持 unified / split 两种显示方式
- [ ] 显示文件路径、修改状态、增删行统计和关闭/返回操作
- [ ] 使用清晰的新增行、删除行、上下文行背景色
- [ ] 优化长文件、横向滚动、代码等宽字体和最大高度行为
- [ ] 统一 `DiffViewer` 与 Changes、History、提交详情之间的数据入口
- [ ] 对空 diff、二进制文件和 diff 加载失败提供明确提示

## 7. History / Commits 面板

- [ ] 将提交表格改为时间线 / 提交列表布局，突出提交图、分支和 tag
- [ ] 展示短 hash、提交信息、作者头像/首字母、相对时间和 refs
- [ ] 将 HEAD、local branch、remote branch、tag 统一成不同样式徽标
- [ ] 点击提交后在右侧打开提交详情
- [ ] 提交详情展示完整 message、作者、时间、父提交和文件变更列表
- [ ] 支持从提交详情进入文件 diff
- [ ] 增加历史加载、空状态和分页/加载更多反馈

## 8. Branches / Stashes / Remotes 面板

### 8.1 Branches

- [ ] 按 Local、Remote 分组展示分支
- [ ] 突出当前分支、ahead / behind 和最后提交信息
- [ ] 提供新建、切换、删除和刷新操作
- [ ] 对删除当前分支、未合并分支等风险场景提供保护性提示

### 8.2 Stashes

- [ ] 改为列表 + 详情布局，展示 stash 编号、message、创建时间和文件数
- [ ] 提供 apply、pop、drop 操作并区分危险级别
- [ ] 支持查看 stash diff
- [ ] 增加无 stash 空状态

### 8.3 Remotes

- [ ] 增加 Remotes 面板（当前详情页缺少独立入口）
- [ ] 展示 remote 名称、fetch URL 和 push URL
- [ ] 为复制 URL、刷新和远程同步预留操作入口

## 9. AI Gateway 视觉统一

- [ ] 保留现有协议、模型、Prompt 和测试请求能力
- [ ] 将 AI Gateway 调整为与应用壳层一致的面板布局
- [ ] 将网关地址、API Key 配置状态、协议和模型选择分组展示
- [ ] 优化请求执行中的 loading、成功、失败和原始响应折叠区
- [ ] 增加响应耗时、HTTP 状态和模型信息的紧凑摘要

## 10. 交互细节与可用性

- [ ] 所有图标按钮补充 Tooltip 和可访问名称
- [ ] 统一键盘焦点、hover、active、disabled 和 selected 状态
- [ ] 统一 Toast / message 文案和错误展示方式
- [ ] 处理 API 请求竞态：切换仓库或面板时避免旧请求覆盖新数据
- [ ] 处理刷新后的选中项保留和无效选中项清理
- [ ] 为树、列表、diff 和详情面板增加合理的滚动容器
- [ ] 检查中英文文案长度对布局的影响

## 11. 响应式与视觉验收

- [ ] 桌面宽屏：三栏工作区布局稳定，文件名和提交信息不异常截断
- [ ] 中等宽度：辅助栏可收起，主内容保持可操作
- [ ] 窄屏：侧栏转为抽屉，操作按钮不溢出
- [ ] 深色导航和浅色内容区的对比度满足可读性要求
- [ ] 检查 hover / focus / selected / disabled 等状态的视觉一致性
- [ ] 检查空仓库、无改动、无分支、无 stash、无远程等边界状态

## 12. 验证与交付

- [ ] 执行前端 TypeScript 检查和生产构建
- [ ] 执行现有后端测试，确认 UI 调整未影响 API
- [ ] 启动本地前后端，验证 Connections、Repositories、Repository Detail、AI Gateway
- [ ] 验证 stage、unstage、commit、push、pull、切换分支和查看 diff 主流程
- [ ] 检查浏览器控制台无新增错误和明显警告
- [ ] 汇总本轮完成项、已知限制和后续可选优化
- [ ] 将 UI 重构作为独立 commit 提交，避免与之前的 AI Gateway commit 混在一起

## 建议实施顺序

1. 基线盘点与设计令牌
2. 全局 AppShell、ActivityBar、RepositoryTree、WorkspaceHeader
3. Repository Detail 工作台骨架
4. Changes + Diff Viewer
5. History + Commit Detail
6. Branches / Stashes / Remotes
7. Connections / Repositories
8. AI Gateway 视觉统一
9. 响应式、可访问性和全流程验证

## 本轮暂不处理

- 不改动后端 Git 命令实现和 API 路径
- 不新增复杂的 Git 图谱算法或远程协作能力
- 不实现收藏/置顶、持久化 UI 布局等非核心状态
- 不替换 React、Vite、Zustand 或现有 Diff Viewer 依赖，除非验证后确有必要
- 不为了视觉模拟而牺牲 stage / commit / push / pull 等现有功能
