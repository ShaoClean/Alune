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

PR/MR 列表、详情、Diff、讨论及命名令牌可在构建 server、web 后执行 `node --test apps/web/tests/pull-requests.integration.cjs`，通过临时 SQLite、Git 仓库与本地 SSH 验证生产 HTTP 接口，托管平台响应由 fixture 模拟。界面验收运行 `node apps/web/tests/pull-requests-fixture.cjs` 并打开输出的 URL；私有 GitLab 场景使用任意非空测试令牌，不需要真实账号，退出进程会清理临时数据。单元测试仍使用各工作区的 `npm test`。

发布前还需使用两个递增版本做实际升级验收：Windows NSIS 和 Linux AppImage 验证下载、用户确认重启、版本提升及原有连接/仓库数据保留；macOS 在两种架构验证 DMG 下载、校验、重启安装、数据保留及安装失败恢复。自动测试不替代正式安装包的这些验收步骤。验收记录应列明版本、操作系统、架构、结果和未验证项；未验证的平台不得标记为已完成自动升级验收。

若本机 npm 配置禁用了安装脚本，首次启动前执行 `node node_modules/electron/install.js` 下载 Electron。构建脚本会在隔离的暂存目录中为 Electron 重建 SQLite，保留网页开发所用的 Node.js 原生模块。

集成测试使用临时数据目录，验证实际 Electron 页面、深链接刷新、SQLite 增删查、HTTP / WebSocket 认证和页面沙箱，不会连接远程服务器或修改已有数据。也可用 `ALUNE_TEST_EXECUTABLE` 指定已打包应用的可执行文件进行同样的测试。

实际验收结果、截图和未验证场景统一记录到 [Wiki](https://github.com/ShaoClean/Alune/wiki)，不在本页累积历史记录。正式发布步骤见[贡献与发布指南](../CONTRIBUTE.md#发布新版本)。

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

批量放弃更改使用 Git 2.23+ 的 `restore --worktree` 保留暂存区；未跟踪文件仅在确认包含它们时直接删除，不进入回收站。构建上述工作区后，运行 `node apps/web/tests/discard-changes-fixture.cjs` 可验证确认范围、筛选、取消、部分失败及 Diff 刷新。fixture 输出界面 URL 和独立的本机测试控制地址，所有文件和数据库均位于临时目录，退出时清理；设计与验收记录见 [Issue-109](https://github.com/ShaoClean/Alune/wiki/Issue-109)。

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

测试使用临时 SQLite 与 Git 仓库；POSIX 环境另启动两个回环 SSH 服务，以真实 PTY 验证认证、特殊路径、输入/resize、隔离、关闭、断线和背压。Windows 集成测试验证 ConPTY；跨平台原生包任务见 `.github/workflows/terminal-tests.yml`。桌面测试覆盖真实输入、保留输出、退出码、L2 关闭确认与取消窗口关闭。系统 IME 和辅助技术需补充人工验收。

`prepare` 会修复 node-pty 1.1.0 中 macOS 预编译 `spawn-helper` 的执行权限。桌面暂存目录独立重建 SQLite 与 node-pty，后者完整解包到 asar 外；不会改动开发服务器的 Node ABI。

[返回项目首页](../README.md) · [文档索引](README.md)
