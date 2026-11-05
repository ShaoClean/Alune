# 开发与打包

开发环境使用 Node.js 22.12+ 和 npm。首次构建需要下载 Electron 和原生依赖；原生模块没有预编译包时，需要系统 C++ 编译工具（macOS：Xcode Command Line Tools；Windows：Visual Studio C++ Build Tools 和 Python；Linux：编译工具链和 Python）。

```sh
git clone https://github.com/ShaoClean/Alune.git
cd alune
npm ci
npm run desktop:dev
```

在仓库根目录运行以上命令。依赖安装同时配置 Git hooks，说明见[贡献与发布指南](../CONTRIBUTE.md)。

`desktop:dev` 构建当前源码并打开桌面窗口。修改源码后重新运行该命令；前端热更新开发先运行 `npm run build -w @alune/shared` 和 `npm run build -w @alune/ssh-client`，再运行 `npm run dev`，浏览器访问 `http://localhost:5173`；本地服务默认监听 `127.0.0.1:3000`。

```sh
npm run desktop:pack  # 生成当前系统可运行的应用目录
npm run desktop:dist  # 生成当前系统安装包
npm run desktop:test  # 构建后执行桌面集成测试
npm run desktop:test:code-appearance # 构建并验证本地/SSH 代码主题、选区与滚动保留
npm run desktop:test:worktrees # 构建并在隔离 SSH 环境验证 worktree 标签与操作
npm run test:repository-session -w desktop # 构建后验证标签跨进程/端口恢复、强杀、删除、断线和列表失败重试
```

产物位于 `apps/desktop/release/`。macOS 生成 `.app`、DMG 和 ZIP；Windows 配置 NSIS 安装程序；Linux 配置 AppImage。请在对应系统构建和验证，原生 SQLite 模块需要匹配目标系统和架构。默认生成当前机器架构。

正式对外发布 macOS 应用还需要配置开发者签名和 Apple 公证；仓库默认可生成本机测试包。Windows 签名同样需要自行提供证书。

图标源文件为 `apps/desktop/assets/alune.png`（至少 1024 × 1024 的正方形 PNG）。修改后运行 `npm run icons:generate`，生成 1024 × 1024 桌面 PNG 和 64 × 64 网页 favicon，并一起提交派生资源。`npm run icons:check` 检查资源是否同步，根构建和桌面构建也会执行此检查。高细节头像在 16–32px 下会损失面部与 Git 饰件细节；正式发布前需在目标系统的任务栏、Dock 和安装包中目视验收。

## Alune-UI 共享组件

共享源码包位于 `packages/ui`。应用与官网示例通过 `@alune/ui` 使用同一实现，样式入口为 `@alune/ui/styles.css`；初始化后无需先生成 UI dist。组件不依赖业务 store、路由、API 或 Electron。

运行 `npm run ui:check` 验证类型、运行时边界、真实示例与导出覆盖；运行 `node apps/website/scripts/ui-api.mjs` 更新自定义 API 数据。中文规范、完整组件 API、隔离示例、贡献与迁移说明见 [Alune-UI 文档](https://shaoclean.github.io/Alune/ui/) 和 [包说明](../packages/ui/README.md)。

## 官网开发

官网位于独立的 `apps/website` Astro workspace。`npm run website:dev` 启动开发服务（`http://127.0.0.1:4321/Alune/`），`npm run website:check` 执行类型检查、构建及站点资源验证，`npm run website:preview` 预览构建产物。

`npm run build` 构建所有 workspace，包含官网；`desktop:build` 与桌面发布仍只构建桌面依赖。官网工作流只安装 `website` 与 `@alune/ui` 并检查和构建官网，不会触发桌面打包。素材、下载链接与 GitHub Pages 部署维护见 [官网说明](../apps/website/README.md)。

## 测试与发布验收

```sh
npm run test:hooks         # 在临时本地仓库验证推送拦截，不连接 GitHub
npm run test:release-notes # 验证分类、发布范围和失败 tag 的处理
npm run desktop:test:unit  # 更新服务、平台适配、IPC、发布元数据
npm run desktop:build
npm run desktop:test      # 隔离数据目录；模拟更新源，无真实下载/安装
npm run dist -w desktop -- --publish never
node apps/desktop/scripts/test-packaged.mjs
```

Linux CI 的桌面测试使用 `xvfb-run -a`。测试中的模拟更新适配器只在 `--smoke-test` 且提供隔离数据目录时启用，测试不会连接 GitHub，也不会启动安装程序。

PR/MR 列表、详情、Diff、讨论及命名令牌可在构建 server、web 后执行 `node --test apps/web/tests/pull-requests.integration.cjs`，通过临时 SQLite、Git 仓库与本地 SSH 验证生产 HTTP 接口，托管平台响应由 fixture 模拟。界面验收运行 `node apps/web/tests/pull-requests-fixture.cjs` 并打开输出的 URL；私有 GitLab 场景使用任意非空测试令牌，不需要真实账号，退出进程会清理临时数据。单元测试仍使用各工作区的 `npm test`。创建与 AI 起草的接口验证运行 `node --test apps/web/tests/pull-request-creation.integration.cjs`；界面验收运行 `node apps/web/tests/pull-request-creation-fixture.cjs`，使用任意非空测试令牌。该环境在临时本地/SSH 仓库中运行，托管平台与 AI 响应均为模拟数据，不创建真实 PR/MR。

发布前还需使用两个递增版本做实际升级验收：Windows NSIS 和 Linux AppImage 验证下载、用户确认重启、版本提升及原有连接/仓库数据保留；macOS 在两种架构验证 DMG 下载、校验、重启安装、数据保留及安装失败恢复。自动测试不替代正式安装包的这些验收步骤。验收记录应列明版本、操作系统、架构、结果和未验证项；未验证的平台不得标记为已完成自动升级验收。

若本机 npm 配置禁用了安装脚本，首次启动前执行 `node node_modules/electron/install.js` 下载 Electron。构建脚本会在隔离的暂存目录中为 Electron 重建 SQLite，保留网页开发所用的 Node.js 原生模块。

集成测试使用临时数据目录，验证实际 Electron 页面、深链接刷新、SQLite 增删查、HTTP / WebSocket 认证和页面沙箱，不会连接远程服务器或修改已有数据。也可用 `ALUNE_TEST_EXECUTABLE` 指定已打包应用的可执行文件进行同样的测试。

实际验收结果、截图和未验证场景统一记录到 [Wiki](https://github.com/ShaoClean/Alune/wiki)，不在本页累积历史记录。正式发布步骤见[贡献与发布指南](../CONTRIBUTE.md#发布新版本)。

### Agent 迁移基线工具

独立 Agent 的内部开发入口与打包方式见 [Agent](../packages/agent/README.md)，通信接入见 [Agent Client](../packages/agent-client/README.md) 和 [协议契约](../packages/protocol/README.md)。当前旧 Web/桌面入口继续作为默认路径；运行 `serve` 不会自动迁移现有用户数据库或凭据。

从已跟踪的源码生成入口清单（HTTP、Socket/IPC、前端 API、导出符号、类方法、JSX/对象回调、浏览器/终端事件监听及测试声明），并保留界面回调表达式和调用线索：

```sh
node scripts/agent-inventory.mjs > /tmp/alune-inventory.json
```

该工具只做静态发现，不计算功能或测试覆盖率。动态 IPC、UI 行为、数据归属和测试断言仍需人工核对；迁移台账、设计和实际结果维护在 [P0 Wiki](https://github.com/ShaoClean/Alune/wiki/Issue-249)，不将生成清单提交到业务代码仓库。

构建 shared、ssh-client、server、web 后，可在 macOS/Linux 使用生产 HTTP 与 Socket.IO 入口测量临时仓库：

```sh
node scripts/agent-baseline.cjs 20 > /tmp/alune-performance.json
```

工具使用隔离 Git 配置和临时 SQLite/仓库，测量小仓库、5,000 文件仓库、64 MiB 大文件仓库；PATH 中有 Git LFS 时增加真实 LFS 夹具，仅在临时仓库执行 `git lfs install --local`。每组记录新应用进程及同进程热运行的 status、单文件 Diff、50 条历史、64 KiB PTY 输出延迟和原始样本。另以 25 ms 间隔采样应用进程树的 RSS/进程数，并在退出后检查观察过的进程是否仍在。

冷启动指应用进程重新启动，不清空操作系统文件缓存。内存高水位包括启动，采样可能遗漏短命进程峰值；终端延迟包含输出命令启动。此工具不测 SSH、UI 渲染或 Windows，也不替代安装包和真实升级验收。测量时避免并行构建/测试，保持机器、Node、夹具及方法一致；缺失 Git LFS 会明确记录为未测，不以普通大文件代替。

### 本地 Git 验证

```sh
npm run build -w @alune/shared
npm run build -w @alune/ssh-client
npm test -w server -- --runInBand local-git.spec.ts
node --test packages/ssh-client/tests/local-connection.test.cjs
node --test packages/ssh-client/tests/discard-changes.test.cjs
```

CI 对本地 Git 集成测试使用 macOS、Windows、Linux 三个平台。测试仓库、SQLite 数据库与远程 bare 仓库均为临时数据，不访问用户仓库。测试覆盖首次提交、部分暂存、字面路径、分支/合并、Stash、Worktree 保护、同步/上游、浅克隆、二进制和图片读取、旧数据库迁移、输出上限和真实 Git hook 取消。

构建 server 和 web 后，运行 `node apps/server/test/local-ui-fixture.cjs` 可在 `http://127.0.0.1:59482` 验证真实本地仓库界面。控制台输出示例仓库、无首次提交仓库和本地 bare 远程的路径；退出时清理临时目录。平台 UI、目录选择器与真实凭据的实际验收结果见 Wiki 的 Issue-82-Validation。

Diff 按块／按行操作的真实 Git 测试位于 `packages/ssh-client/tests/partial-changes.test.cjs`，覆盖本地、关联 Worktree 和本机 SSH 服务。HTTP 测试为 `apps/server/src/git/partial-diff.spec.ts`。构建 shared、ssh-client、server 和 web 后，运行 `node apps/web/tests/partial-diff-fixture.cjs` 可对生产接口和界面进行联合验收；输出界面 URL 与独立测试控制 URL。控制接口支持 POST `{ "reset": true }` 重置临时仓库、`{ "edit": true }` 模拟外部修改，并返回工作区、暂存区和两侧 Diff 用于核对。所有数据位于临时目录，退出进程会清理。

批量放弃更改使用 Git 2.23+ 的 `restore --worktree` 保留暂存区；未跟踪文件仅在确认包含它们时直接删除，不进入回收站。构建上述工作区后，运行 `node apps/web/tests/discard-changes-fixture.cjs` 可验证确认范围、筛选、取消、部分失败及 Diff 刷新。fixture 输出界面 URL 和独立的本机测试控制地址，所有文件和数据库均位于临时目录，退出时清理；设计与验收记录见 [Issue-109](https://github.com/ShaoClean/Alune/wiki/Issue-109)。

### 文件逐行追溯验证

构建 shared、ssh-client、server 和 web 后，执行：

```sh
node --test packages/ssh-client/tests/blame.test.cjs
node --test apps/web/tests/blame.integration.cjs
node apps/web/tests/blame-fixture.cjs
```

前两项使用真实 Git、临时本地与 SSH 仓库验证逐行归属、Worktree、重命名父版本、忽略空白／提交、未提交行、编码、大小限制和 HTTP 参数。第三项输出本地、SSH、Worktree 界面地址，历史包含超过 50 条后续提交，可验证旧提交跳转；退出后清理临时数据。

### 提交历史筛选验证

构建 shared、ssh-client、server 和 web 后，执行：

```sh
node --test packages/ssh-client/tests/log-filters.test.cjs
node --test apps/web/tests/history-filter.integration.cjs
node apps/web/tests/history-filter-fixture.cjs
```

前两项在多作者、多分支、文件两次重命名的临时仓库中，将信息、哈希、作者、时间、分支和路径筛选的分页结果与 `git log` 逐条核对，并验证 `--follow` 的逐提交路径及本地、SSH、Worktree 一致。第三项输出三种仓库的界面地址，可验证筛选栏、文件历史与清除后恢复选择；退出后清理临时数据。

### 仓库终端验证

终端模块默认禁用；桌面启动时使用随机 Bearer token 开启。嵌入式认证服务通过 `startServer({ token, ... })` 明确开启，不能仅以绑定回环地址或 CORS 代替认证。终端命名空间 `/terminal` 每条连接独立拥有会话；断线会销毁其 PTY，重连不恢复进程。

```sh
npm run build -w @alune/shared
npm run build -w @alune/ssh-client
npm run build -w server
npm test -w server -- --runInBand terminal.service.spec.ts
node --test apps/server/test/terminal.integration.cjs
npm run desktop:build
npm run test:terminals -w desktop
npm run pack -w desktop
npm run test:terminals -w desktop -- --packaged
```

测试使用临时 SQLite 与 Git 仓库；POSIX 环境另启动两个回环 SSH 服务，以真实 PTY 验证认证、特殊路径、输入/resize、隔离、关闭、断线和背压。Windows 集成测试验证 ConPTY，并通过分别以 cmd.exe 和 Windows PowerShell 为默认 shell 的回环 SSH 服务验证远端终端的特殊路径、目录检查、交互输入、退出码和连接复用；跨平台原生包任务见 `.github/workflows/terminal-tests.yml`。桌面测试覆盖真实输入、保留输出、退出码、L2 关闭确认与取消窗口关闭。系统 IME 和辅助技术需补充人工验收。

`prepare` 会修复 node-pty 1.1.0 中 macOS 预编译 `spawn-helper` 的执行权限。桌面暂存目录独立重建 SQLite 与 node-pty，后者完整解包到 asar 外；不会改动开发服务器的 Node ABI。

[返回项目首页](../README.md) · [文档索引](README.md)

### 提交签名验证

构建 shared、ssh-client、server 和 web 后，运行 `node --test packages/ssh-client/tests/signing.test.cjs` 与 `node --test apps/web/tests/signing.integration.cjs`，在临时本地与 SSH 仓库验证真实签名、修改提交、附注标签、篡改、缺失信任配置、密钥缺失和失败后 HEAD／暂存区保留。真实 GPG 测试需要安装 GPG，缺失时明确跳过；pinentry 失败使用受控程序模拟，不替代桌面弹窗验收。

运行 `node apps/web/tests/signing-fixture.cjs` 可打开生产界面做签名验收。fixture 使用临时 SSH 密钥、本地 SSH 服务与独立数据目录，输出本地和远端仓库 URL；退出时清理。Windows 的测试 SSH 服务暂不支持执行命令，只运行本地用例。发布前仍需在各平台实际确认 GPG／SSH agent 和桌面 pinentry；使用说明见[提交签名](commit-signing.md)。

### Agent 仓库读写验收

默认入口保持旧路径；开发者可在一次性夹具中接入 Agent 读写：

```sh
node scripts/agent/browser-reads-fixture.mjs
```

该脚本使用临时仓库和数据目录，启动本机 Web、旧写入口与 stdio Agent 的测试 WebSocket 桥。
在测试页面动态导入 `/tests/agent-browser.ts` 并调用 `connectFixture()` 后，所选夹具仓库的 Git 读取、预览与写入经过真实 Browser SDK/Agent；未映射的仓库保留旧入口。写入失败时不切换执行者。
结束时关闭返回的连接，并停止脚本清理临时资源。此桥只用于本机测试，不是对外部署入口。

现有 `scripts/agent-baseline.cjs` 支持 `ALUNE_BASELINE_READS_ONLY=1` 仅测 P3 读取；
同时设置 `ALUNE_BASELINE_AGENT_READS=1` 可测 HTTP 查询桥加真实 stdio Agent。
`ALUNE_BASELINE_SOURCE_ROOT` 可指定已构建的冻结旧检出。比较必须使用同机同 Node、相同样本数与场景，保留原始结果；冷进程不代表系统冷缓存。

### 独立 Agent 候选入口（P8/P9 验收）

使用 Node 22，在根目录执行 `npm ci`。启动独立 Web 工作区用 `npm run web:agent`，使用终端显示的“打开本机工作区”完整链接（含本次启动的片段口令，请勿分享）。Vite 只接受本机同源 WebSocket，停止 Vite 时关闭其 Agent。开发数据默认在 `~/.alune/agent`，可用 `ALUNE_AGENT_DATA_DIR` 指向独立测试目录。Web 旧数据可在停用旧服务后用独立包的 `legacy-import --source 旧目录 --data-dir 新目录` 导入；受 Electron safeStorage 保护的数据须使用原设备的桌面程序迁移。

桌面源码验收依次运行 `npm run desktop:build`、`npm run agent:stage -w desktop`，再设置环境变量 `ALUNE_DESKTOP_EXECUTOR=agent` 并运行 `npm start -w desktop`。候选安装包使用 Resources 中随应用分发的 Node/Agent，不依赖系统 Node；Git 仍需另行安装。每个工作区会话单独初始化，日志窗口只能读取日志。首次连接 SSH 主机须提供独立核对的主机公钥指纹；按 [Agent 部署说明](../packages/agent/README.md) 预置对应平台运行包，然后显式批准在目标安装。

首次启动从旧数据捕获只读快照，导入到用户数据下独立的 `agent` 目录。原数据库、工作区偏好和凭据保留；导入失败会停止启动。退出候选程序并取消 `ALUNE_DESKTOP_EXECUTOR` 即可还原旧入口和旧数据。重新启用旧程序不会撤销已执行的 Git、文件或平台写入，应先检查写回执和实际仓库状态。没有全平台逐项放行之前，不删除旧执行器、备份或兼容入口。
