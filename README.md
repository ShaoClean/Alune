<p align="center">
  <img src="apps/desktop/assets/icon.png" width="96" height="96" alt="Alune 图标" />
</p>

<h1 align="center">Alune</h1>

<p align="center">
  <strong>在桌面上，统一管理本地与 SSH 远程 Git 仓库。</strong>
</p>

<p align="center">
  打开本地仓库或通过 SSH 连接服务器，在一个工作区里查看差异、暂存提交、浏览文件与历史。<br />
  支持 macOS、Windows 和 Linux；安装即用，无需安装 Node.js 或单独启动后端。
</p>

<p align="center">
  <a href="https://github.com/ShaoClean/Alune/releases/latest">下载安装</a> ·
  <a href="https://github.com/ShaoClean/Alune/issues/97">更新日志</a> ·
  <a href="#快速上手">快速上手</a> ·
  <a href="#核心功能">核心功能</a> ·
  <a href="https://github.com/ShaoClean/Alune/wiki">项目文档</a> ·
  <a href="https://github.com/users/ShaoClean/projects/1">公开 TODO</a>
</p>

![Alune 0.5.0 浅色工作区：本机与 SSH 仓库标签、七个仓库视图、中央 Diff，以及右侧暂存和提交区](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-v0.5.0/workspace-light.png)

<p align="center">从文件差异到暂存与提交，在同一个 Git 工作区完成。</p>

[Alune-UI 文档](https://shaoclean.github.io/Alune/ui/) · [共享组件源码](packages/ui/README.md)

## 为什么使用 Alune

Alune 支持打开本机 Git 仓库，也可以通过 SSH 操作远程开发机或构建服务器上的仓库。本机与 SSH 分组共用 Diff、暂存、提交、历史和同步界面，来源与完整路径始终可见。

## 核心功能

| 功能                    | 能力与操作入口                                                                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **本地 Git 工作区**     | 从“仓库 → 打开本地仓库”选择目录或输入完整路径；支持首次提交、无远程、浅克隆、多仓库标签和搜索排序。本机需安装 Git 并将其加入 PATH。                                                                                                         |
| **SSH 远程工作区**      | 从底部“工作区导航 → 管理远程连接”添加密码、私钥或 SSH Agent 连接；连接卡片的“查看仓库 → 扫描并添加”可登记已有仓库。左侧仓库导航与底部工作区导航支持搜索和切换。                                                                             |
| **文本与图片 Diff**     | 在“改动”中选择已暂存或未暂存文件，中央查看统一／分栏文本差异，或 PNG、JPEG、GIF、WebP 的前后图片；新文件无需暂存即可预览。可从 Diff 工具栏“全屏查看差异”铺满应用窗口。                                                                      |
| **浏览仓库文件**        | 工具条“文件”按需展开目录树，只读预览带行号、语法高亮和编码信息的文本，或 PNG、JPEG、GIF、WebP 图片。文件阅读支持代码主题、字体与字号设置；不支持预览的文件会说明原因。                                                                      |
| **暂存与提交**          | 在“改动”右侧暂存所需文件，填写摘要和可选描述，点击“提交已暂存内容”；同一文件的已暂存内容与后续改动分别展示。以单行列表和文件类型图标展示改动文件。                                                                                          |
| **批量放弃更改**        | “未暂存”分组右侧的“放弃所有更改”先预览影响范围，再确认执行；保留已暂存内容。默认保留未跟踪文件，删除未跟踪文件需另外勾选并确认。                                                                                                            |
| **分支与同步**          | 工具条右侧当前分支名称是“切换分支”入口；左侧“分支”进入管理视图，可创建、切换、重命名、安全删除和合并分支；首次推送可设置上游。右侧“拉取”“推送”执行同步，推送旁下拉的“更多推送选项 → 获取远程更新”执行获取。                                 |
| **提交历史与分支图**    | 工具条“提交历史”展示已获取的本地分支、远程跟踪分支和标签关系；滚动到底部自动加载，选择提交查看文件与 Diff。                                                                                                                                 |
| **PR / MR 与访问令牌**  | 工具条“PR/MR”查看所选远端收到的 GitHub PR 或 GitLab MR，支持筛选、分页，以及应用内阅读详情、文件 Diff、评论和代码讨论。“设置 → 访问令牌”保存命名令牌，回到 PR/MR 页选择并“应用到此仓库”；也可匿名读取或仅本次输入。支持 HTTPS 自建 GitLab。 |
| **仓库终端（开发版）** | 从工具条“终端”在登记目录打开本机或 SSH 交互式 shell；支持多会话、Worktree、调整高度、跨仓库找回与关闭确认。会话不跨应用重启恢复。 |
| **多标签与 Worktree**   | 顶部标签可拖动排序，右键可关闭当前、其他、左侧或右侧标签。分支旁“查看关联 Worktrees”在独立标签打开工作区；本地仓库还可创建和删除 Worktree，SSH 仓库支持发现与打开。关闭标签保留目录和仓库登记。                                             |
| **AI 提交信息（可选）** | “设置 → AI 服务商／提交生成”配置服务与默认模型；摘要框右侧星光按钮根据已暂存改动生成可编辑的摘要和描述，描述下方显示模型与生成范围。支持 OpenAI、Anthropic、Gemini、DeepSeek 或兼容服务。                                                   |
| **外观与代码主题**      | “设置 → 外观”支持跟随系统、浅色、深色及减少动态效果。“代码阅读”内置四款 Catppuccin 主题，可设置本机字体、字号并导入 VS Code 主题 JSON／JSONC；只影响文件阅读，Diff 沿用原有配色与字体。                                                     |
| **布局与快捷键**        | “设置 → 布局”调整面板显隐、宽度和默认 Diff 模式。`Cmd/Ctrl+B` 切换左侧导航，`Cmd/Ctrl+Shift+B` 切换右侧面板，`Cmd/Ctrl+,` 打开设置；聚焦标签后用 `Alt+←/→` 调整顺序。                                                                       |
| **网络代理**            | “设置 → 网络代理”配置 HTTP、HTTPS 或 SOCKS5，供 AI 请求、版本更新、SSH 连接和远端 Git 同步使用。修改后显式保存，已有 SSH 连接需“重新连接并应用”；本地 Git 同步和 PR/MR 查询沿用各自现有配置。                                               |

改动视图从上到下为**标签栏 → 仓库工具条 → 左侧仓库导航／中央 Diff／右侧改动与提交 → 底部状态栏**。提交历史选中提交后，上方是提交图，下方是文件与 Diff；不同视图不固定为三栏。底部工作区导航集中提供仓库切换、浏览全部仓库、管理远程连接、设置与帮助。

工具条左侧依次平铺“改动｜文件｜提交历史｜分支｜储藏｜远程｜PR/MR”七个视图；“刷新仓库”是右侧“拉取”前的独立图标按钮。窗口变窄时视图先收为图标，仍放不下时可横向滚动，所有入口始终保留，可通过悬停提示定位。左右面板可隐藏、拖动调宽；详细入口、同步限制与快捷键见[工作区使用说明](docs/workspace.md)。

“仓库”和“SSH 连接”页右上角均可切换**卡片／列表**，分别记住本设备的显示方式。仓库可按本机或 SSH 连接筛选；工作区左侧仍可直接搜索并打开仓库。

<details>
<summary><strong>查看深色工作区、文件阅读、提交历史与仓库列表</strong></summary>

![Alune 0.5.0 深色工作区：Diff、未暂存与已暂存分组，以及提交摘要和描述](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-v0.5.0/workspace-dark.png)

![Alune 文件阅读：展开工作区目录树，以 Catppuccin Mocha 主题预览带行号的 TSX 文件](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-v0.5.0/files.png)

![Alune 提交历史：上方显示分支提交图，下方展示所选提交的文件与差异](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-v0.5.0/history.png)

![Alune 仓库列表：本机与 SSH 来源、仓库路径、状态、操作及卡片和列表切换](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-v0.5.0/repositories.png)

</details>

<details>
<summary><strong>查看 0.5.0 的代码主题与网络代理设置</strong></summary>

![Alune 代码阅读设置：代码主题、字体、字号、实时预览与自定义主题导入，左侧展示七个设置分类](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-v0.5.0/code-appearance.png)

![Alune 网络代理设置：代理类型与地址、保存操作、生效范围及连接测试入口](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-v0.5.0/network-proxy.png)

</details>

以上截图与操作说明基于 [v0.5.0](https://github.com/ShaoClean/Alune/releases/tag/v0.5.0)（[`e86dc78`](https://github.com/ShaoClean/Alune/commit/e86dc78d3b675084743f59c940f2ab1aafbe1ad5)）。截图使用临时 Git 仓库、本机测试 SSH 服务和演示数据，展示该版本的网页界面；桌面窗口边框与系统对话框以实际平台为准。[截图基线与采集说明](https://github.com/ShaoClean/Alune/wiki/README-Screenshots-v0.5.0)

## 下载安装

前往 **[最新稳定版 Release](https://github.com/ShaoClean/Alune/releases/latest)**，在 Assets 中选择与你的系统和芯片匹配的安装包。

| 系统               | 选择的文件                           | 安装方式                                            |
| ------------------ | ------------------------------------ | --------------------------------------------------- |
| macOS · Apple 芯片 | `Alune-<版本>-mac-arm64.dmg`         | 打开 DMG，将 Alune 拖入“应用程序”后启动。           |
| macOS · Intel 芯片 | `Alune-<版本>-mac-x64.dmg`           | 打开 DMG，将 Alune 拖入“应用程序”后启动。           |
| Windows · x64      | `Alune-<版本>-win-x64.exe`           | 运行安装程序，按提示选择安装位置。                  |
| Linux · x64        | `Alune-<版本>-linux-x86_64.AppImage` | 在文件属性中允许作为程序执行，再直接运行 AppImage。 |

Release 同时提供 `SHA256SUMS` 供校验。当前安装包尚未配置平台签名，macOS 尚未公证；首次启动可能出现系统提示。安装与更新条件见[桌面端说明](docs/desktop.md)。

已安装的桌面版可在 **设置 → 版本更新** 中检查、下载新版本，下载完成后点击“重启安装”。开发中的变更和各版本记录见[公开更新日志](https://github.com/ShaoClean/Alune/issues/97)；正式发布说明见[全部 Releases](https://github.com/ShaoClean/Alune/releases)。

## 快速上手

本机需安装 Git，并有当前账号可读写的 Git 仓库。使用 SSH 工作区时，远程主机也需安装 Git；提交作者与同步凭据由实际执行 Git 的主机提供。

1. **打开仓库。** 首屏进入“仓库”，点击“打开本地仓库”，选择目录并检查，然后打开工作区。使用 SSH 时，在“连接”页点击“添加连接”；已在工作区时，从底部“工作区导航 → 管理远程连接”进入。填写主机、端口、用户名和认证信息，选择私钥时填写本机私钥的绝对路径。点击“保存连接”，再用连接卡片的“测试连接”确认可用。
2. **添加 SSH 仓库（可选）。** 点击连接卡片上的“查看仓库 → 扫描并添加”，输入远端目录（例如 `/home/developer/projects`），点击“扫描”，在结果中选择“添加”，再点击“打开工作区”。之后可从底部“工作区导航 → 浏览全部仓库”返回仓库列表；扫描前需选定连接。
3. **检查并提交。** 在工具条“改动”中选择文件查看 Diff，暂存要提交的内容，填写摘要，点击“提交已暂存内容”。检查右侧当前分支与远程配置后，按需使用工具条的“拉取”或“推送”主按钮；只获取远程更新时，点推送旁下拉“更多推送选项 → 获取远程更新”。
4. **按需配置协作与网络。** 私有仓库可先在“设置 → 访问令牌”保存命名令牌，再到仓库“PR/MR”页选择并点击“应用到此仓库”。需要代理时，在“设置 → 网络代理”填写并保存配置；已建立的 SSH 连接点击“重新连接并应用”。配置与覆盖范围见[网络代理说明](docs/network-proxy.md)。
5. **按需启用 AI 和代码主题。** 在“设置 → AI 服务商”保存服务配置并启用模型，再在“提交生成”选择并保存默认模型。返回仓库，用摘要框右侧星光按钮生成提交信息，检查后主动提交；详见 [AI 设置说明](docs/ai-settings.md)。“设置 → 外观 → 代码阅读”可选择文件阅读主题、字体与字号，并导入自定义主题。

AI 只分析已暂存改动，会将这些差异发送给你配置的模型服务；不启用 AI 也可使用 Git 功能。批量放弃操作会保留已暂存内容，执行前请核对确认框中的影响范围。关闭标签保留仓库目录；本地 Worktree 的目录删除是单独的确认操作。减少动态效果同时遵循系统与应用设置，系统已开启时始终生效。

## 文档与开发

| 我想了解…                         | 入口                                                                                |
| --------------------------------- | ----------------------------------------------------------------------------------- |
| 布局、Diff、提交历史与 Worktree   | [工作区使用说明](docs/workspace.md)                                                 |
| 安装更新、数据目录与桌面行为      | [桌面端说明](docs/desktop.md)                                                       |
| AI 服务商、模型与密钥配置         | [AI 设置说明](docs/ai-settings.md)                                                  |
| 代理设置、生效时机与远端 Git 转发 | [网络代理说明](docs/network-proxy.md)                                               |
| 从源码运行、构建与测试            | [开发与打包](docs/development.md)                                                   |
| 待发布变更和版本历史              | [公开更新日志](https://github.com/ShaoClean/Alune/issues/97)                        |
| 提交规范、Git hooks 与版本发布    | [贡献与发布指南](CONTRIBUTE.md)                                                     |
| 功能设计、验收记录与截图          | [GitHub Wiki](https://github.com/ShaoClean/Alune/wiki) · [文档索引](docs/README.md) |

## 反馈与贡献

欢迎通过 [Issue 模板](https://github.com/ShaoClean/Alune/issues/new/choose)报告问题、提出功能或优化建议，也可以从[公开 TODO 看板](https://github.com/users/ShaoClean/projects/1)了解进展、挑选任务。计划中的能力以 Issue 为准。

提交 PR 前请阅读[贡献指南](.github/CONTRIBUTING.md)，关联对应 Issue 并记录验证结果。设计、验收和配套截图统一维护在 Wiki，文档归属及旧路径见[维护约定](https://github.com/ShaoClean/Alune/wiki/Contributing)与[迁移清单](https://github.com/ShaoClean/Alune/wiki/Migration-25)。
