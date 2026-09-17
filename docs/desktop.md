# 桌面端使用与数据

从[最新稳定版 Release](https://github.com/ShaoClean/remote-git/releases/latest)下载与你的系统和架构匹配的安装包，选择方式见[下载安装](../README.md#下载安装)。安装版内置界面、本地服务和数据库，无需安装 Node.js。

## 安装条件

- macOS：打开 DMG，将应用拖入“应用程序”后启动。更新要求应用位于当前用户可写的目录，不要直接在 DMG 内运行。当前安装包未配置 Developer ID 签名和 Apple 公证；若系统拦截，在确认下载来源后按 macOS“隐私与安全性”的提示处理。
- Windows：运行 x64 NSIS 安装程序。当前未配置签名证书；确认安装包来自项目 Release 后按系统提示操作。
- Linux：为 x64 AppImage 添加可执行权限（文件属性中允许作为程序执行，或运行 `chmod +x <下载的文件名>`），从可写位置直接运行。解包后的目录不支持应用内更新。

Release 提供 `SHA256SUMS`，可使用系统的 SHA-256 工具核对下载文件。macOS 也提供 ZIP 归档，首次安装推荐 DMG。

## GitHub 版本更新

桌面端的“设置 → 版本更新”显示实际应用版本、最新稳定版本、更新说明与下载进度。已打包应用启动 10 秒后后台检查一次，也可手动检查。下载由用户点击触发，支持取消和重试；关闭设置或刷新页面不会中断下载。开发模式与独立网页不会访问更新源。

- macOS（arm64、x64）：下载匹配架构的 DMG，核对 Release 的 `SHA256SUMS` 后显示“重启安装”。点击后会再次校验文件，挂载 DMG 并检查应用标识、版本和二进制架构，在当前应用所在目录准备新版本，再关闭 SSH、数据库和本地服务。独立安装程序等旧进程退出后替换应用并自动重新打开；替换或启动命令失败时恢复原应用，下次启动在更新设置中显示错误。应用必须位于可写目录，从 DMG 或 App Translocation 中运行时会提示先移动应用。普通退出不会安装。当前构建未配置 Developer ID 签名和 Apple 公证，仍遵循系统 Gatekeeper 检查；正式分发需另行配置签名和公证，与上架 App Store 无关。
- Windows（x64 NSIS）、Linux（x64 AppImage）：通过 `electron-updater` 下载并校验安装包，点击“重启安装”才会关闭 SSH、数据库及本地服务并安装。普通退出不会安装。服务关闭失败或超时会中止安装；此时请重新启动应用后重试。Linux 必须直接运行可写位置的 AppImage，解包目录运行方式不支持更新。
- 检查只接受更高的稳定 SemVer 版本，跳过草稿、预发布和降级。网络失败不会打断日常操作，设置中可查看错误并重试。macOS 安装包及安装日志 `install.log` 保存在应用数据目录的 `updates/` 中；Windows/Linux 使用更新器的系统缓存目录。

更新源固定为 `https://github.com/ShaoClean/remote-git` 的公开 Releases，客户端不包含 GitHub Token。没有可用 Release、缺失更新附件或无法访问 GitHub 时无法提供更新。原先没有更新功能的旧安装包需要先手动安装首个支持更新的版本。

## 桌面行为与数据

- 一个应用实例，重复启动会激活已有窗口；支持窗口尺寸恢复、原生菜单、缩放、全屏和复制粘贴。
- macOS 关闭窗口后仍可从 Dock 重新打开，使用 `Cmd+Q` 退出。Windows / Linux 关闭最后一个窗口即退出。
- `Cmd/Ctrl+1` 打开连接，`Cmd/Ctrl+2` 打开仓库。
- 本地服务仅监听 `127.0.0.1` 的随机端口，并要求每次启动生成的访问令牌；HTTP 和 WebSocket 请求均由 Electron 主进程自动认证。
- 页面启用沙箱和上下文隔离，禁用 Node.js 集成。界面和后端均包含在安装包中；连接远程仓库仍需要网络。
- 数据目录：macOS 为 `~/Library/Application Support/RemoteGit`；Windows 为 `%APPDATA%/RemoteGit`；Linux 通常为 `~/.config/RemoteGit`。
- 首次桌面启动时，若旧版 `~/.remote-git/remote-git.db` 存在且桌面数据库不存在，会通过 SQLite 在线备份导入。旧数据库保留；之后桌面版与网页版分别保存数据。
- 退出应用会关闭 SSH 连接、数据库与本地服务。

开发、打包和测试命令见[开发与打包](development.md)，版本发布流程见[贡献与发布指南](../CONTRIBUTE.md)。

[返回项目首页](../README.md) · [文档索引](README.md)
