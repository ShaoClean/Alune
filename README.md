# RemoteGit

通过 SSH 管理远程服务器上的 Git 仓库。桌面端采用 Electron，内置 React 界面、NestJS 服务和 SQLite，无需用户安装 Node.js 或单独启动后端。

## 开发与打包

开发环境使用 Node.js 22.12+ 和 npm。首次构建需要下载 Electron 和原生依赖；原生模块没有预编译包时，需要系统 C++ 编译工具（macOS：Xcode Command Line Tools；Windows：Visual Studio C++ Build Tools 和 Python；Linux：编译工具链和 Python）。

```sh
npm install
npm run desktop:dev
```

`desktop:dev` 构建当前源码并打开桌面窗口。修改源码后重新运行该命令；前端热更新开发仍可使用 `npm run dev`，浏览器访问 `http://localhost:5173`。

```sh
npm run desktop:pack  # 生成当前系统可运行的应用目录
npm run desktop:dist  # 生成当前系统安装包
npm run desktop:test  # 构建后执行桌面集成测试
```

产物位于 `apps/desktop/release/`。macOS 生成 `.app`、DMG 和 ZIP；Windows 配置 NSIS 安装程序；Linux 配置 AppImage。请在对应系统构建和验证，原生 SQLite 模块需要匹配目标系统和架构。默认生成当前机器架构。

正式对外发布 macOS 应用还需要配置开发者签名和 Apple 公证；仓库默认可生成本机测试包。Windows 签名同样需要自行提供证书。

## GitHub 版本更新

桌面端的“设置 → 版本更新”显示实际应用版本、最新稳定版本、更新说明与下载进度。已打包应用启动 10 秒后后台检查一次，也可手动检查。下载由用户点击触发，支持取消和重试；关闭设置或刷新页面不会中断下载。开发模式与独立网页不会访问更新源。

- macOS（arm64、x64）：下载匹配架构的 DMG，核对 Release 的 `SHA256SUMS` 后才允许打开。下载后点击“打开安装包”，退出正在运行的 RemoteGit，再将应用拖入“应用程序”完成替换。首版不签名、不公证，不通过 App Store 分发；Gatekeeper 可能拦截，需用户确认来源后按系统提示允许打开。未来接入 macOS 自动安装需要 Developer ID 签名，与上架 App Store 无关。
- Windows（x64 NSIS）、Linux（x64 AppImage）：通过 `electron-updater` 下载并校验安装包，点击“重启安装”才会关闭 SSH、数据库及本地服务并安装。普通退出不会安装。服务关闭失败或超时会中止安装；此时请重新启动应用后重试。Linux 必须直接运行可写位置的 AppImage，解包目录运行方式不支持更新。
- 检查只接受更高的稳定 SemVer 版本，跳过草稿、预发布和降级。网络失败不会打断日常操作，设置中可查看错误并重试。macOS 文件保存在应用数据目录的 `updates/` 中；Windows/Linux 使用更新器的系统缓存目录。

更新源固定为 `https://github.com/ShaoClean/remote-git` 的公开 Releases，客户端不包含 GitHub Token。**当前私有仓库需要由维护者另行改为公开**，再使用正式发布流程；未公开、没有 Release 或缺失更新附件时无法提供更新。原先没有更新功能的旧安装包需要先手动安装首个支持更新的版本。

### 发布新版本

`.github/workflows/release.yml` 在推送 `vX.Y.Z` 标签后运行，标签必须与根 `package.json` 及锁文件版本一致。根包版本是唯一版本来源，暂存应用和前端构建均从这里读取。

`npm install` / `npm ci` 会自动安装仓库的 `pre-push` hook；已有工作区可运行 `npm run hooks:install` 启用。分支推送会检查根 `package.json` 与锁文件两处根版本是否一致；推送 `v*` 标签时，还会检查标签是否为匹配版本的稳定 SemVer。检查读取实际推送的提交，支持附注标签、一次推送多个引用及指定远端标签名；修改工作区文件不能修复指向旧提交的标签。删除引用和非发布标签不受此检查影响。

安装脚本会保留已有的自定义 hooks 配置并提示如何接入。禁用 npm 安装脚本时，需手动运行 `npm run hooks:install`。本地 hook 使用 Node.js 和 Git，无需加载项目依赖；GitHub Actions 继续执行发布校验。

```sh
npm version patch --no-git-tag-version --workspaces=false
RELEASE_TAG="v$(node -p 'require("./package.json").version')"
node apps/desktop/scripts/release.mjs tag "$RELEASE_TAG"
git add package.json package-lock.json
git commit -m "chore: bump desktop version"
git tag "$RELEASE_TAG"
git push origin HEAD
git push origin "$RELEASE_TAG"
```

Actions 使用 macOS arm64/x64、Windows x64、Linux x64 原生 runner，重建 Electron 的 SQLite 模块、执行测试并生成安装包。构建步骤禁用发布；最终发布任务核对所有平台附件、更新元数据的大小与 SHA-512，再生成 `SHA256SUMS`。附件全部上传到草稿后才公开 Release。上传失败保留草稿，允许重跑；已公开的 Release 不允许覆盖。构建失败则不创建 Release。

安装包命名为 `RemoteGit-<version>-<mac|win|linux>-<arch>.<dmg|zip|exe|AppImage>`，其中 Linux x64 的 AppImage 使用架构名 `x86_64`。请保留工作流生成的 blockmap、`latest.yml`、`latest-linux.yml` 和 `SHA256SUMS`，不要单独替换安装包。发布仅使用 Actions 的 `GITHUB_TOKEN`，只有最终发布任务拥有 `contents: write`，无需个人令牌。此流程尚未配置平台签名证书。

### 更新测试与发布验收

```sh
npm run test:hooks         # 在临时本地仓库验证推送拦截，不连接 GitHub
npm run desktop:test:unit  # 更新服务、平台适配、IPC、发布元数据
npm run desktop:build
npm run desktop:test      # 隔离数据目录；模拟更新源，无真实下载/安装
npm run dist -w desktop -- --publish never
node apps/desktop/scripts/test-packaged.mjs
```

Linux CI 的桌面测试使用 `xvfb-run -a`。测试中的模拟更新适配器只在 `--smoke-test` 且提供隔离数据目录时启用，测试不会连接 GitHub，也不会启动安装程序。

发布前还需使用两个递增版本做实际升级验收：Windows NSIS 和 Linux AppImage 验证下载、用户确认重启、版本提升及原有连接/仓库数据保留；macOS 在两种架构验证 DMG 下载、校验、打开及手动替换。自动测试不替代这些真机步骤。验收记录应列明版本、操作系统、架构、结果和未验证项；未验证的平台不得标记为已完成自动升级验收。

若本机 npm 配置禁用了安装脚本，首次启动前执行 `node node_modules/electron/install.js` 下载 Electron。构建脚本会在隔离的暂存目录中为 Electron 重建 SQLite，保留网页开发所用的 Node.js 原生模块。

## 桌面行为与数据

- 一个应用实例，重复启动会激活已有窗口；支持窗口尺寸恢复、原生菜单、缩放、全屏和复制粘贴。
- macOS 关闭窗口后仍可从 Dock 重新打开，使用 `Cmd+Q` 退出。Windows / Linux 关闭最后一个窗口即退出。
- `Cmd/Ctrl+1` 打开连接，`Cmd/Ctrl+2` 打开仓库。
- 本地服务仅监听 `127.0.0.1` 的随机端口，并要求每次启动生成的访问令牌；HTTP 和 WebSocket 请求均由 Electron 主进程自动认证。
- 页面启用沙箱和上下文隔离，禁用 Node.js 集成。界面和后端均包含在安装包中；连接远程仓库仍需要网络。
- 数据目录：macOS 为 `~/Library/Application Support/RemoteGit`；Windows 为 `%APPDATA%/RemoteGit`；Linux 通常为 `~/.config/RemoteGit`。
- 首次桌面启动时，若旧版 `~/.remote-git/remote-git.db` 存在且桌面数据库不存在，会通过 SQLite 在线备份导入。旧数据库保留；之后桌面版与网页版分别保存数据。
- 退出应用会关闭 SSH 连接、数据库与本地服务。

集成测试使用临时数据目录，验证实际 Electron 页面、深链接刷新、SQLite 增删查、HTTP / WebSocket 认证和页面沙箱，不会连接远程服务器或修改已有数据。也可用 `REMOTE_GIT_TEST_EXECUTABLE` 指定已打包应用的可执行文件进行同样的测试。
