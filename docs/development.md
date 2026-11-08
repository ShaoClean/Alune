# 开发与打包

开发环境使用 Node.js 22.22.0 和 npm，Git 建议使用 2.43+（旧 Apple Git 对 GPG 失败诊断不完整）。首次构建需要下载 Electron 和原生依赖；原生模块没有预编译包时，需要系统 C++ 编译工具（macOS：Xcode Command Line Tools；Windows：Visual Studio C++ Build Tools 和 Python；Linux：编译工具链和 Python）。

```sh
git clone https://github.com/ShaoClean/Alune.git
cd alune
npm ci
npm run desktop:dev
```

在仓库根目录运行以上命令。依赖安装同时配置 Git hooks，说明见[贡献与发布指南](../CONTRIBUTE.md)。

`desktop:dev` 构建当前源码与随包 Agent 并打开桌面窗口，无需执行器开关。前端热更新直接运行 `npm run dev`，使用终端显示的完整本机工作区链接（含本次启动的片段口令，请勿分享）。普通 Web 与桌面均使用 Agent，不再启动旧 HTTP 服务或 Socket.IO。

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

PR/MR、AI、命名令牌和多主机协作由 `packages/agent/tests/collaboration.test.cjs`、`settings-rpc.test.cjs`、`hosts.test.cjs` 验证；Web API 与本机网关分别运行 `npm run test:agent-dev -w web`。测试使用临时数据库、Git/SSH 和受控平台响应，不创建真实 PR/MR。旧 HTTP 集成夹具已退役。

发布前还需使用两个递增版本做实际升级验收：Windows NSIS 和 Linux AppImage 验证下载、用户确认重启、版本提升及原有连接/仓库数据保留；macOS 在两种架构验证 DMG 下载、校验、重启安装、数据保留及安装失败恢复。自动测试不替代正式安装包的这些验收步骤。验收记录应列明版本、操作系统、架构、结果和未验证项；未验证的平台不得标记为已完成自动升级验收。

若本机 npm 配置禁用了安装脚本，首次启动前执行 `node node_modules/electron/install.js` 下载 Electron。SQLite/PTY 只在独立 Agent 内以 Node ABI 构建；桌面 UI 宿主不再携带 Electron ABI 数据库。

集成测试使用临时数据目录，验证实际 Electron 页面、深链接刷新、SQLite 增删查、Agent IPC / WebSocket 认证和页面沙箱，不会连接远程服务器或修改已有数据。也可用 `ALUNE_TEST_EXECUTABLE` 指定已打包应用的可执行文件进行同样的测试。

实际验收结果、截图和未验证场景统一记录到 [Wiki](https://github.com/ShaoClean/Alune/wiki)，不在本页累积历史记录。正式发布步骤见[贡献与发布指南](../CONTRIBUTE.md#发布新版本)。

### 默认 Agent 入口与迁移

业务代码由 `packages/agent` 负责，`agent-client` 是通信 SDK，`domain` / `protocol` 提供领域与协议契约。旧 `apps/server`、`packages/shared`、`packages/ssh-client` 已退役；不再支持旧 HTTP/Socket.IO 回退。一次性旧数据导入与安全解密桥仍保留。

- Web：`npm run dev`（`npm run web:agent` 仍为等价入口）。仅监听 `127.0.0.1`，使用终端显示的邀请链接，同源 WebSocket 承载 Agent RPC。默认状态为 `~/.alune/agent`；`ALUNE_AGENT_DATA_DIR` 可指定隔离目录，显式目录只导入 `ALUNE_AGENT_LEGACY_DIR` 指定的旧源。
- 桌面：`npm run desktop:dev` / `desktop:pack` / `desktop:dist` 均使用 Agent。安装包带匹配版本/架构的 Node 与 Agent，不依赖系统 Node；Git 仍须另行安装。`ALUNE_CANDIDATE_DATA_DIR` 可隔离测试数据，不自动发现个人独立 Web 数据。
- 首次启动前退出旧程序和独立服务，保存原库、WAL、JSON 偏好、凭据密钥与可运行旧安装包。首次启动只读捕获旧数据，导入独立 `agent` 子目录；失败停止启动，不启用旧写者、不降级明文。原数据不删除。
- 桌面旧 `safe-storage:` 凭据由主进程通过专用子进程 IPC 白名单解密，不能从浏览器调用；Web 旧 AES 凭据使用原 `ai-master-key`。完整离线恢复用 Agent 的 `recovery-backup` / `recovery-restore`，数据库备份不能替代凭据恢复包。恢复口令应与备份分开保管。
- 回退须先退出新程序，再使用已验证的旧应用及原数据副本；移除环境变量不再切换执行器。恢复状态不撤销 Git、文件或平台副作用，`unknown` 写回执不得自动重发。SSH 首次连接仍须独立核对公钥指纹并明确授权部署。

### Agent、Git 与终端验证

```sh
npx turbo build --filter=@alune/agent
npm test -w @alune/agent
npm test -w @alune/agent-client
npm test -w web
npm run test:retirement
node scripts/agent/check-boundaries.mjs
npm run desktop:build
npm run desktop:test
node apps/desktop/scripts/check-candidate.mjs --default
```

36 个原 SSH/Git 回归文件迁入 `packages/agent/tests/git-*.test.cjs`，直接测试 Agent 模块，不再经兼容工作区转发。它们覆盖本地/回环 SSH、部分暂存、放弃、Worktree、签名、子模块/LFS、历史、文件与代理。PTY、背压与退出由 `terminals.test.cjs` 验证。使用临时仓库，不访问用户仓库；缺少工具或非适用平台的 skip 必须单独报告。系统 IME、原生安装和真实升级仍需相应验收。

`npm run desktop:candidate:build`、`npm run dist:candidate -w desktop` 保留为验收产物目录命令；与普通入口使用同一 Agent 执行器，不存在旧版构建分支。

### 历史性能与入口台账

`node scripts/agent-inventory.mjs` 发现当前 Agent/UI/SDK 源码入口，仅用于静态检查，不替代冻结的 P0 台账、功能审查或测试回执。历史 HTTP 性能对照必须显式设置 `ALUNE_BASELINE_SOURCE_ROOT` 指向已构建的冻结旧检出；旧 Socket.IO 依赖只从该检出解析，当前工作区不再安装。Agent 计时使用 `ALUNE_BASELINE_UI=1`。不得改写历史 SHA 或将冷进程描述为清空系统缓存。

### 独立 Agent 候选入口（P8/P9 验收）

独立 Agent 与普通桌面均不依赖已退役工作区。候选安装器和完整台账门槛仍独立于源码默认切换；源码、单元测试或模拟更新通过，不代表当前安装器的真实升级/回退验收完成。

最终退役前、后分别核对 [P0 台账](https://github.com/ShaoClean/Alune/wiki/Issue-249) 与该提交的执行回执：`node scripts/agent/check-release-evidence.mjs ledger.json receipts.json missing.json`。回执含 `stage`（before-retirement / after-retirement）、`sha`、`baseline`、`runs`；每个 run 明确 target、sha、scenario、assertion、proof URL、result 与覆盖的 P0 原始 entry ID 数组。原生安装、打包、更新、clean checkout 单列平台。缺少条目、平台或放行项目时命令退出非零；人工仍须核对证据与断言是否匹配，运行过一个文件不等于其中所有控件已验收。

在桌面冒烟的专用 Web 构建中设置 `ALUNE_UI_AUDIT=1`，以 `ALUNE_CANDIDATE_EVIDENCE` 接收场景断言和实际触发的 P0 回调。用 `node scripts/agent/ui-audit-index.mjs ledger.json apps/web/tests/p0-ui-index.json` 从冻结 Git 树重建索引；`node scripts/agent/ui-audit-map.mjs` 仅报告哪些回调可被唯一识别，不计作通过。相同回调文本须由语法上下文消除歧义，具名 DOM 监听器只有在能保留移除语义时才包装。常规构建和独立发布包不启用追踪。

Agent 候选桌面测试需要 Git 和 OpenSSL CLI。测试进程会在临时目录中生成仅限回环地址的短期证书；自建 GitLab、HTTP 代理与探测目标都在本机运行。验收分别检查服务端收到的评论、行范围、草稿和代理请求，并在关闭前核对 Git 数据。证书只通过测试子进程的 `NODE_EXTRA_CA_CERTS` 提供，不更改系统信任设置。 凭据表单用例在两个进程之间，只为刚迁移且还没有任何凭据的临时测试目录初始化隔离的文件密钥库；不读取或替换用户的系统密钥。改名和换值都必须由测试服务的后续请求证实。OS 密钥库的真实升级由安装与回退作业独立验证。 独立运行包下载遇到连接超时、连接重置或 HTTP 502/503/504 时，在同一个截止时间内最多尝试三次；每次重新获取完整内容，仍需通过官方 Node SHA-256 校验才能解包。

下载同一作业的四个 `candidate-ui-*` 附件到独立子目录后，执行 `node scripts/agent/ui-receipts.mjs ARTIFACTS ledger.json ui-receipts.json`。仅将实际触发且属于对应断言范围的 P0 回调交给台账；其他运行记录和功能/平台门槛仍需另行归入同一阶段的回执。

定位某组候选验收时，构建桌面并暂存 Agent 后，可在 `apps/desktop` 目录运行 `node scripts/smoke.mjs --focus conflicts` ，其他分组可选 `reviews`、`settings`、`terminals`、`web`、`files`、`branches`、`file-retries`、`updates` 和 `repositories`。它们自动选择 Agent，在独立临时目录只执行指定工作区场景组；reviews 使用本机隔离 HTTPS 对端并核对实际请求内容；web 使用独立临时 Agent 数据目录和 Vite/WS 服务，在没有桌面 preload 的隔离浏览器窗口中验证回退路径。日志明确标为 focused，不执行完整 write/restore，不作为全量回归或四平台放行。`file-retries` 在临时仓库制造目录／文件消失，再通过页面自己的重试按钮恢复并核对真实字节、HEAD 与 index；`updates` 通过已挂载设置页验证检查、失败重试、取消和重启安装按钮，仅调用 smoke 适配器，绝不替代真实安装包更新验收。修复后仍须用不带 `--focus` 的候选冒烟运行完整矩阵。

逐原始 ID 对账时，可执行：

```bash
node scripts/agent/reconcile-ui-evidence.mjs ledger.json previous-ui.json manifest.json ui-reconciliation.json
```

`manifest.json` 含真实 `currentSha`、`observations: [{label, directory, sha}]` 和可选 `reviews`。每项 review 明确 `id`、`disposition`（`needs-test` / `existing-assertion-needs-replay` / `unwired` / `mapping-review`）、`reason` 及源码／测试 `references: [{file, line}]`。观察目录相对于 manifest，保留原有 `workbench.json`、场景 JSONL 和完成标记；只有非 focused 的 write、restore 两阶段及各自非空场景文件齐备，才标作 complete trace。历史 SHA 不改标为当前执行。

工具保留所有原始 UI ID 和历史关联；同 family 的 `pass` 源码仅是检索候选，实际触发轨迹也仍需逐 ID 审查断言范围。审查确认后可在 manifest 添加 `associations: [{id, observation, scenario, reason, references}]`（`observation` 为 observations 的 0 起始索引，`scenario` 必须与原始记录完全相同）；工具拒绝该场景没有命中的 ID、无断言 family 交集和重复关联。经审查的部分回放仍只标为 partial assertion，且只证明所述场景，不代表该回调所有分支。`releaseEligible` 固定为 false，不能作为放行回执。未接线旧控件单列，不删台账或借新控件补记通过。若使用未提交的验收驱动，须额外保存 `source-state.json`（真实 HEAD、dirty、输入哈希）、补丁和新增源码副本；工具核对已提供的补丁／副本哈希并保留来源，缺失溯源会明确标注，HEAD 标签本身不证明干净构建。工具防误认测试运行 `node --test scripts/agent/reconcile-ui-evidence.test.mjs`。
