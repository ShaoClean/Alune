<p align="center">
  <img src="apps/desktop/assets/icon.png" width="96" height="96" alt="Alune 图标" />
</p>

<h1 align="center">Alune</h1>

<p align="center">
  <strong>在桌面上，看清并管理远程服务器上的 Git 改动。</strong>
</p>

<p align="center">
  通过 SSH 连接服务器，在一个工作区里查看差异、暂存提交、浏览分支与历史。<br />
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

![Alune 浅色改动工作区：顶部仓库标签、中央文本 Diff，以及右侧紧凑的改动文件列表与提交区](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-8ce088e/workspace-light.png)

<p align="center">从文件差异到暂存与提交，在同一个远程仓库工作区完成。</p>

## 为什么使用 Alune

代码在远程开发机或构建服务器上时，Alune 让你直接查看和操作那里的 Git 仓库，无需为查看改动再克隆一份到本地。按连接组织多个仓库，在标签页间切换，完成从检查差异到提交、拉取和推送的日常工作。

## 核心功能

| 功能                    | 能力与操作入口                                                                                                                                                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SSH 远程工作区**      | 从底部“工作区导航 → 管理远程连接”添加密码、私钥或 SSH Agent 连接；连接卡片的“查看仓库 → 扫描并添加”可登记已有仓库。左侧仓库导航与底部工作区导航支持搜索和切换。                                                                                        |
| **文本与图片 Diff**     | 在“改动”中选择已暂存或未暂存文件，中央查看统一／分栏文本差异，或 PNG、JPEG、GIF、WebP 的前后图片；新文件无需暂存即可预览。可从 Diff 工具栏“全屏查看差异”铺满应用窗口。                                                                                 |
| **暂存与提交**          | 在“改动”右侧暂存所需文件，填写摘要和可选描述，点击“提交已暂存内容”；同一文件的已暂存内容与后续改动分别展示。开发代码以单行列表和文件类型图标展示改动文件。                                                                                             |
| **分支与同步**          | 工具条右侧当前分支名称是“切换分支”入口；左侧“分支”进入管理视图，可创建、切换和合并分支。右侧“拉取”“推送”执行同步，推送旁下拉的“更多推送选项 → 获取远程更新”执行获取。                                                                                  |
| **提交历史与分支图**    | 工具条“提交历史”展示已获取的本地分支、远程跟踪分支和标签关系；滚动到底部自动加载，选择提交查看文件与 Diff。                                                                                                                                            |
| **多标签与 Worktree**   | 分支旁的 Worktrees 图标（提示“查看关联 Worktrees”）打开已有的关联工作区，形成独立仓库标签，各自查看改动、暂存和提交；窄窗口入口移至“更多仓库视图 → 关联 Worktree”。关闭标签不删除目录。开发代码支持拖动顶部标签排序，聚焦标签时也可按 `Alt+←/→` 移动。 |
| **AI 提交信息（可选）** | “设置 → AI 服务商／提交生成”配置服务与默认模型；摘要框右侧星光按钮根据已暂存改动生成可编辑的摘要和描述，描述下方显示模型与生成范围。支持 OpenAI、Anthropic、Gemini、DeepSeek 或兼容服务。                                                              |
| **外观与布局**          | “设置 → 布局”调整面板显隐、宽度及默认 Diff 模式。“设置 → 外观”支持跟随系统／浅色／深色与减少动态效果，新装默认跟随系统，修改立即生效并在本设备保存。                                                                                                   |

改动视图从上到下为**标签栏 → 仓库工具条 → 左侧仓库导航／中央 Diff／右侧改动与提交 → 底部状态栏**。提交历史选中提交后，上方是提交图，下方是文件与 Diff；不同视图不固定为三栏。底部工作区导航集中提供仓库切换、浏览全部仓库、管理远程连接、设置与帮助。

工具条左侧的“更多仓库视图”（省略号）还提供储藏、远程、分支管理和刷新仓库。窄窗口会缩短按钮文案或显示图标，可通过悬停提示定位。左右面板可隐藏、拖动调宽；详细入口、同步限制与快捷键见[工作区使用说明](docs/workspace.md)。

<details>
<summary><strong>查看深色工作区、提交历史、Worktree 与外观设置</strong></summary>

![Alune 深色工作区：相同导航、Diff 和提交区采用深色主题](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-8ce088e/workspace-dark.png)

![Alune 提交历史：上方显示分支提交图，下方展示所选提交的文件与差异](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-8ce088e/history.png)

![Alune Worktree：关联工作区在独立标签打开，工具条显示其分支，右侧显示该目录的改动](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-8ce088e/worktree.png)

![Alune 外观设置：跟随系统、浅色、深色及减少动态效果](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-8ce088e/appearance.png)

</details>

以上截图采自开发代码 [`8ce088e`](https://github.com/ShaoClean/Alune/commit/8ce088e0d28bed9a3dec8afa2160df48eaca73f2)，使用隔离测试仓库和演示数据。新文件列表与顶部标签排序尚未包含在 v0.3.3 安装包中，截图不代表该稳定版的外观。[截图基线与采集说明](https://github.com/ShaoClean/Alune/wiki/README-Screenshots-8ce088e)

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

准备一台可通过 SSH 登录的服务器：远端需已安装 Git，并有当前账号可读写的 Git 仓库。提交前在远端配置好 Git 作者信息；推送或拉取所需的凭据也由远端 Git 环境提供。

1. **添加连接。** 首次进入“SSH 连接”页，点击“添加连接”；已在工作区时，从底部“工作区导航 → 管理远程连接”进入。填写主机、端口、用户名和认证信息，选择私钥时填写本机私钥的绝对路径。点击“保存连接”，再用连接卡片的“测试连接”确认可用。
2. **添加仓库。** 点击连接卡片上的“查看仓库 → 扫描并添加”，输入远端目录（例如 `/home/developer/projects`），点击“扫描”，在结果中选择“添加”，再点击“打开工作区”。之后可从底部“工作区导航 → 浏览全部仓库”返回仓库列表；扫描前需选定连接。
3. **检查并提交。** 在工具条“改动”中选择文件查看 Diff，暂存要提交的内容，填写摘要，点击“提交已暂存内容”。检查右侧当前分支与远程配置后，按需使用工具条的“拉取”或“推送”主按钮；只获取远程更新时，点推送旁下拉“更多推送选项 → 获取远程更新”。
4. **按需启用 AI。** 从底部工作区导航进入“设置 → AI 服务商”，保存服务配置并启用模型，再在“提交生成”选择并保存默认模型。返回仓库，点击摘要框右侧星光按钮（提示“生成提交信息”）。描述框下方显示当前模型与生成范围，点击模型会进入“提交生成”设置。生成结果可编辑、撤销，检查后由你主动提交。详见 [AI 设置说明](docs/ai-settings.md)。

AI 只分析已暂存改动，会将这些差异发送给你配置的模型服务；不启用 AI 也可使用 Git 功能。Worktree 入口用于打开已有工作区，暂不创建或删除 Worktree。减少动态效果同时遵循系统与应用设置，系统已开启时始终生效。

## 文档与开发

| 我想了解…                       | 入口                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| 布局、Diff、提交历史与 Worktree | [工作区使用说明](docs/workspace.md)                                                 |
| 安装更新、数据目录与桌面行为    | [桌面端说明](docs/desktop.md)                                                       |
| AI 服务商、模型与密钥配置       | [AI 设置说明](docs/ai-settings.md)                                                  |
| 从源码运行、构建与测试          | [开发与打包](docs/development.md)                                                   |
| 待发布变更和版本历史            | [公开更新日志](https://github.com/ShaoClean/Alune/issues/97)                        |
| 提交规范、Git hooks 与版本发布  | [贡献与发布指南](CONTRIBUTE.md)                                                     |
| 功能设计、验收记录与截图        | [GitHub Wiki](https://github.com/ShaoClean/Alune/wiki) · [文档索引](docs/README.md) |

## 反馈与贡献

欢迎通过 [Issue 模板](https://github.com/ShaoClean/Alune/issues/new/choose)报告问题、提出功能或优化建议，也可以从[公开 TODO 看板](https://github.com/users/ShaoClean/projects/1)了解进展、挑选任务。计划中的能力以 Issue 为准。

提交 PR 前请阅读[贡献指南](.github/CONTRIBUTING.md)，关联对应 Issue 并记录验证结果。设计、验收和配套截图统一维护在 Wiki，文档归属及旧路径见[维护约定](https://github.com/ShaoClean/Alune/wiki/Contributing)与[迁移清单](https://github.com/ShaoClean/Alune/wiki/Migration-25)。
