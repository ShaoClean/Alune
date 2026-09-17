<p align="center">
  <img src="apps/desktop/assets/icon.png" width="96" height="96" alt="RemoteGit 图标" />
</p>

<h1 align="center">RemoteGit</h1>

<p align="center">
  <strong>在桌面上，看清并管理远程服务器上的 Git 改动。</strong>
</p>

<p align="center">
  通过 SSH 连接服务器，在一个工作区里查看差异、暂存提交、浏览分支与历史。<br />
  支持 macOS、Windows 和 Linux；安装即用，无需安装 Node.js 或单独启动后端。
</p>

<p align="center">
  <a href="https://github.com/ShaoClean/remote-git/releases/latest">下载安装</a> ·
  <a href="#快速上手">快速上手</a> ·
  <a href="#核心功能">核心功能</a> ·
  <a href="https://github.com/ShaoClean/remote-git/wiki">项目文档</a> ·
  <a href="https://github.com/users/ShaoClean/projects/1">公开 TODO</a>
</p>

![RemoteGit 提交历史：左侧仓库导航、所有分支提交图，以及下方的文件变更与 Diff](https://raw.githubusercontent.com/wiki/ShaoClean/remote-git/assets/issue-36/history-detail.png)

<p align="center">多仓库导航、分支提交图和文件差异，集中在同一个工作区。</p>

## 为什么使用 RemoteGit

代码在远程开发机或构建服务器上时，RemoteGit 让你直接查看和操作那里的 Git 仓库，无需为查看改动再克隆一份到本地。按连接组织多个仓库，在标签页间切换，完成从检查差异到提交、拉取和推送的日常工作。

## 核心功能

| 功能                    | 你可以做什么                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| **SSH 远程工作区**      | 使用密码或私钥连接服务器，扫描并登记已有仓库，按名称搜索和切换。                             |
| **差异与提交**          | 统一或分栏查看 Diff，预览未暂存的新文件，区分已暂存和后续改动，再填写摘要与描述提交。        |
| **分支与同步**          | 创建、切换和合并分支，管理储藏，获取、拉取和推送远程更新。                                   |
| **提交历史与分支图**    | 查看本地已获取的各分支、远程跟踪分支和标签的提交关系，连续加载历史，展开提交查看文件与差异。 |
| **多标签与 Worktree**   | 将已有的关联 Worktree 打开为独立仓库标签，各自查看改动、暂存和提交；关闭标签不删除目录。     |
| **AI 提交信息（可选）** | 配置 OpenAI、Anthropic、Gemini、DeepSeek 或兼容服务，根据已暂存改动生成可编辑的摘要和描述。  |

左右面板支持隐藏、拖动调宽和专注阅读，布局偏好在本机保存。更多操作与快捷键见[工作区使用说明](docs/workspace.md)。

<details>
<summary><strong>查看改动与 Worktree 独立标签截图</strong></summary>

![RemoteGit 改动工作区：Worktree 在独立标签打开，中央显示 Diff，右侧管理暂存内容与提交](https://raw.githubusercontent.com/wiki/ShaoClean/remote-git/assets/issue-29/worktree-tab.png)

</details>

截图复用 Wiki 中的实际应用验收素材，使用测试仓库与演示数据；界面版本以安装的 Release 为准。

## 下载安装

前往 **[最新稳定版 Release](https://github.com/ShaoClean/remote-git/releases/latest)**，在 Assets 中选择与你的系统和芯片匹配的安装包。

| 系统               | 选择的文件                               | 安装方式                                            |
| ------------------ | ---------------------------------------- | --------------------------------------------------- |
| macOS · Apple 芯片 | `RemoteGit-<版本>-mac-arm64.dmg`         | 打开 DMG，将 RemoteGit 拖入“应用程序”后启动。       |
| macOS · Intel 芯片 | `RemoteGit-<版本>-mac-x64.dmg`           | 打开 DMG，将 RemoteGit 拖入“应用程序”后启动。       |
| Windows · x64      | `RemoteGit-<版本>-win-x64.exe`           | 运行安装程序，按提示选择安装位置。                  |
| Linux · x64        | `RemoteGit-<版本>-linux-x86_64.AppImage` | 在文件属性中允许作为程序执行，再直接运行 AppImage。 |

Release 同时提供 `SHA256SUMS` 供校验。当前安装包尚未配置平台签名，macOS 尚未公证；首次启动可能出现系统提示。安装与更新条件见[桌面端说明](docs/desktop.md)。

已安装的桌面版可在 **设置 → 版本更新** 中检查、下载新版本，下载完成后点击“重启安装”。[全部版本与更新记录](https://github.com/ShaoClean/remote-git/releases)

## 快速上手

准备一台可通过 SSH 登录的服务器：远端需已安装 Git，并有当前账号可读写的 Git 仓库。提交前在远端配置好 Git 作者信息；推送或拉取所需的凭据也由远端 Git 环境提供。

1. **添加连接。** 打开“连接 → 添加连接”，填写主机、端口、用户名和认证信息。选择私钥时填写本机私钥的绝对路径。保存后点击“测试连接”，确认连接成功。
2. **添加仓库。** 点击连接卡片上的“查看仓库”，再点击“扫描并添加”。输入远端仓库所在目录（例如 `/home/developer/projects`），点击“扫描”，在结果中选择“添加”，然后“打开工作区”。
3. **检查并提交。** 在“改动”中选择文件查看 Diff，暂存需要提交的内容，填写摘要后点击“提交已暂存内容”。确认目标分支和远端后，可使用顶部的获取、拉取和推送。
4. **按需启用 AI。** 在“设置 → AI 服务商”保存服务与模型，再在“提交生成”保存默认模型。返回仓库，点击摘要右侧的星光按钮生成提交信息；检查并编辑后再提交。详见 [AI 设置说明](docs/ai-settings.md)。

AI 生成会将已暂存差异发送给你配置的模型服务；不启用 AI 也可使用 Git 功能。Worktree 入口用于打开已有工作区，暂不创建或删除 Worktree。

## 文档与开发

| 我想了解…                       | 入口                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| 布局、Diff、提交历史与 Worktree | [工作区使用说明](docs/workspace.md)                                                      |
| 安装更新、数据目录与桌面行为    | [桌面端说明](docs/desktop.md)                                                            |
| AI 服务商、模型与密钥配置       | [AI 设置说明](docs/ai-settings.md)                                                       |
| 从源码运行、构建与测试          | [开发与打包](docs/development.md)                                                        |
| 提交规范、Git hooks 与版本发布  | [贡献与发布指南](CONTRIBUTE.md)                                                          |
| 功能设计、验收记录与截图        | [GitHub Wiki](https://github.com/ShaoClean/remote-git/wiki) · [文档索引](docs/README.md) |

## 反馈与贡献

欢迎通过 [Issue 模板](https://github.com/ShaoClean/remote-git/issues/new/choose)报告问题、提出功能或优化建议，也可以从[公开 TODO 看板](https://github.com/users/ShaoClean/projects/1)了解进展、挑选任务。计划中的能力以 Issue 为准。

提交 PR 前请阅读[贡献指南](.github/CONTRIBUTING.md)，关联对应 Issue 并记录验证结果。设计、验收和配套截图统一维护在 Wiki，文档归属及旧路径见[维护约定](https://github.com/ShaoClean/remote-git/wiki/Contributing)与[迁移清单](https://github.com/ShaoClean/remote-git/wiki/Migration-25)。
