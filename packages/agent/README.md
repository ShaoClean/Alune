# @alune/agent

当前 P8/P9 候选：桌面和本机 Web 均可通过同一个 Agent Client 使用工作区；独立桌面候选包不含 Nest、旧 SSH 执行器或 Electron ABI 的数据库。普通 stdio、受 SSH 限制的叶节点和客户端宿主的私有多会话 IPC 入口分别为 `serve`、`serve-remote`、`serve-ui`；最后一种只允许通过继承的 IPC 通道启动。仓库文档后面的阶段段落描述当时的交接范围，当前候选构建和回退流程见[开发与打包](../../docs/development.md#独立-agent-候选入口p8p9-验收)。未发布新正式版本。


独立 Node Agent，提供会话运行时、版本化状态、配置与凭据、代理、诊断及仓库/文件/Git 读取能力。协议 1.3 可执行本机 Git、文件和 Worktree 写操作；协议 1.4 支持本机仓库终端；桌面默认入口保持现状。

CLI、握手和独立包的应用版本在构建时读取根 package.json，遵循仓库唯一版本来源；workspace 包自身版本不作为对外发行版本。

```sh
npm run build -w @alune/agent
node packages/agent/bin/alune-agent.cjs version
node packages/agent/bin/alune-agent.cjs doctor
node packages/agent/bin/alune-agent.cjs serve --data-dir /path/to/agent-data
```

`doctor` 实际执行临时内存 SQLite 查询、Node 子进程 PTY 和 Git 版本探测；缺少依赖时输出诊断并以非零码退出。`serve` 的 stdout 只允许 NDJSON 协议，错误写 stderr；不能用交互式调试输出污染 stdout。

`serve` 首先要求 `initialize`，随后提供 `agent.health`、`agent.version`、`agent.capabilities`、`events.subscribe`、`events.ack`、`requests.cancel` 和 `tasks.get`。初始化返回明确能力集，未知方法或不同协议 major 被拒绝。`agentId` 保存到数据目录的 identity.json；sessionId 每次启动改变。损坏身份文件拒绝启动，不静默重新生成 ID。

首期只有会话模式。EOF、信号或协议错误关闭会话，取消运行中任务并调用资源回收；超出退出期限或回收失败以非零码退出。内存中保留当前会话最近 1,024 项；业务写请求另有 SQLite 持久记录，可跨重启按 requestId/taskId 查询。中断记录变为 unknown，重复 requestId 不再次执行。持久记录只含任务元数据，不含参数、凭据或结果正文。记录被淘汰、备份恢复后缺失或未找到均不授权重放写操作。同一通道 requestId 使用固定前缀和严格递增序号，重复/倒退 ID 关闭通道；只需保存序号上界即可拒绝历史重放，不随请求总量累积 ID，也不强制每 4,096 次请求断线。同时最多 64 个业务任务，超限明确拒绝且不自动重放。

业务处理器通过 `Handler` 端口注册，声明 query/mutation、参数校验和执行函数。每次执行分配 taskId，可用 requestId 或 taskId 查询状态；持久写记录返回 `scope: agent`，会话查询返回 `scope: session`。写任务取消/断线可能已有副作用，不能把请求取消当作回滚；未知结果需要核对仓库事实。

事件可靠流使用 `events.write(...)` 并等待消费方 ACK；可传 AbortSignal，生产者不能忽略 Promise 而无限发送。状态通知使用 `notifyState`，合并/溢出后发送 `events.resync-required`，消费者据此重新读取快照。队列按 UTF-8 字节数和条目数限额，预留控制消息空间；每个事件必须分块到 64 KiB 以下。ACK 超时终止会话。

目录职责：`cli` 命令、`bootstrap` 装配/退出协调、`server` 会话分发、`runtime` 共享任务/事件机制；`ports` 定义处理器、SQL、文档、凭据、文件读取和 Git 进程契约。`modules/settings`、`accounts`、`diagnostics` 和 `migration` 保存业务规则；`adapters` 处理 SQLite、系统密钥、网络和文件 I/O。Agent 不依赖 Electron/Nest 控制器。

运行 `npm test -w @alune/agent`，包括真实子进程、取消/断线/重复写、ACK/重同步、SQLite/PTY 与身份生命周期。

## 状态存储基础

`serve` 现在打开 Agent 自己的数据目录，不自动读取或迁移旧桌面/服务端数据库。SQLite 进程写锁保证同一数据目录只有一个写者，崩溃后由操作系统释放锁；数据使用经过版本/结构/身份校验的数据库目录和原子指针。

协议 1.1 提供 `storage.status` 和 `storage.backupDatabase`，Client 对应 `storageStatus()`、`backupDatabase()`。协议 1.0 会话只保留原有能力。

```sh
node packages/agent/bin/alune-agent.cjs state-backup --data-dir /path/to/agent-data
node packages/agent/bin/alune-agent.cjs state-restore --data-dir /path/to/agent-data --backup /path/to/backup
```

这些命令当前仅处理新 Agent 的状态数据库，明确返回 `database-only`；它们不是旧配置/凭据的完整迁移或导出工具。恢复要求服务停止并取得写锁，校验备份散列/版本/Agent 身份后切换到新的数据库目录，保留旧目录及损坏指针，不修改仓库或未提交文件。缺少/损坏身份不会被静默替换。

POSIX 使用用户专有权限；Windows 使用内置 PowerShell 设置当前用户与 SYSTEM 的受保护 DACL，子进程有超时与取消。修订冲突、损坏/未来版本、软链接/目录联接和硬链接不以创建空状态掩盖。写任务在执行前持久登记，结束后记录结果状态。退出时取消并等待拥有的工作；原生文件读取在返回取消之前关闭句柄，Git 命令契约保留 AbortSignal、输出限制和二进制模式。

## 配置、凭据与诊断

协议 1.1 按能力集提供以下方法；1.0 客户端继续使用原核心能力。

| 范围       | 方法                                                                   |
| ---------- | ---------------------------------------------------------------------- |
| AI 配置    | `settings.ai.get/saveProvider/saveModels/saveCommit`                   |
| 网络代理   | `settings.proxy.get/save`                                              |
| 凭据准备   | `settings.credentials.prepare`                                         |
| 命名令牌   | `accounts.tokens.list/save/delete`                                     |
| 主机档案   | `accounts.hosts.list/save/delete`                                      |
| 日志       | `diagnostics.logs.settings/saveSettings/client/snapshot/chunk/release` |
| 更新器回环 | `network.updaterBridge`                                                |

写配置携带读取到的 revision，冲突时重新读取；SDK 提供对应类型化方法。主机档案此阶段只处理持久配置，SSH 连接运行时仍由后续阶段接入。凭据读取只返回存在标记，解密方法仅供内部适配器使用。保存凭据可以初始化密钥；读取配置不创建系统密钥，调用方也可显式 `prepareCredentials()`。

macOS 默认使用 Keychain，Windows 使用 CurrentUser DPAPI，Linux 无桌面环境使用用户私有文件密钥。后端、keyId 和指纹持久固定；已就绪的密钥丢失、损坏或锁定时不自动生成替代物、不改走另一个后端。显式恢复工具会创建新的本机保护记录并重新加密库内凭据，原记录保留。密钥 Buffer 在关闭后清零。

代理使用不可变修订快照；改配置影响后续请求，运行中的传输继续使用原快照。认证/连接失败不直连。更新器接口只返回本 Agent 主机上的回环端口、agentId、修订和启用标记，不返回认证信息；消费方必须确认它对应本机 Agent。PR/MR 和内部 HTTP/WebSocket 的原有代理覆盖范围保持不变。

`recentLogs()` 通过不可变快照和 32 KiB 数据块重组 UTF-8，日志变化事件只携带失效通知。单快照最多 16 MiB，缓存总计最多 32 MiB / 4 项，60 秒过期；超限明确报错，可减少请求条数，磁盘日志保留策略不变。客户端日志每条最多 1 MiB、每分钟最多 60 条；诊断上报回执为会话范围，不写持久业务任务表。日志字段、历史记录和已知密文前缀均经过脱敏。

## 旧数据导入

```sh
node packages/agent/bin/alune-agent.cjs legacy-import --source /path/to/legacy-data --data-dir /path/to/agent-data
```

先停止旧数据目录的写者。目标必须没有已有业务数据；来源 `alune.db`、`ai-settings.json`、`network-proxy.json`、`logging.json` 和 `workspace.json` 以只读方式捕获到目标的私有 `migration-sources` 目录。来源在捕获或解密期间发生变化会中止；未知数据库版本或列不会被静默降级或丢弃。导入前另做目标数据库备份，全部业务数据与导入回执在同一事务提交。

导入保留主机/仓库/令牌 ID 和布局引用，重新加密 SSH 密码/口令、AI Key、代理认证和命名令牌；旧密钥文件不创建、不修复权限、不覆盖。重复导入同一来源快照返回原回执，来源变化或目标已有业务配置则拒绝覆盖。损坏来源、失败快照、旧数据库目录均保留，Git 工作区不被修改。

独立 Node 来源使用原来的 `ai-master-key`。Electron `safe-storage:` 来源必须由旧宿主通过专用导入子进程的继承 Node IPC 解密：`apps/desktop/src/legacy-agent-secrets.cjs` 只接受宿主提供的精确密文白名单，每项一次，结束后释放。它不注册 renderer IPC 或 TCP 接口；直接运行 CLI 无法自行解密 Electron 来源。普通桌面和 Web 默认通过专用只读导入流程迁移到独立 Agent 目录；直接运行 `serve` 不会自行导入旧数据。

## 身份、状态和库内凭据恢复

数据库备份命令保留 `database-only` 含义；需要密钥/身份恢复时使用下面的加密封装。口令从 stdin 读取（12–1024 UTF-8 字节，可带一个结尾换行），不接受命令行参数或环境变量，也不回显。下面的输入文件由操作者自行保护。

```sh
node packages/agent/bin/alune-agent.cjs recovery-backup --data-dir /path/to/agent-data --output /path/to/state.recovery < /path/to/protected-passphrase-input
node packages/agent/bin/alune-agent.cjs recovery-restore --data-dir /path/to/agent-data --input /path/to/state.recovery < /path/to/protected-passphrase-input
```

停止该 Agent 后执行。封装采用随机 salt/nonce、scrypt 和 AES-256-GCM，包含身份、数据库与恢复库内凭据所需的密钥材料；元数据也被加密。输出文件不覆盖已有文件。恢复先验证认证标签、数据库散列/结构/身份，再在持有写锁时创建新的本机密钥、重新保护凭据并切换数据库指针；旧目录、身份文件和保护记录保留。错误口令、篡改、不同 Agent 身份或正在运行的写者会拒绝恢复。

范围为应用身份、数据库和库内凭据，包含配置与布局；不打包 Git 工作区、日志历史、旧来源归档或 `privateKeyPath` 指向的外部 SSH 私钥文件。恢复不会撤销 Git 操作。恢复旧快照后缺少任务记录不代表外部操作未发生，仍须核对事实，不能自动重放。

## 独立运行包

```sh
node scripts/agent/package.mjs --output /tmp/alune-agent-package
node scripts/agent/test-packaged.mjs /tmp/alune-agent-package
node scripts/agent/test-ssh-isolated.mjs /tmp/alune-agent-package
```

隔离 SSH 验收会把独立包和所需测试对端放进新的临时目录，以包内 Node 与 SDK 验证 SSH 部署、代理、SQLite/PTY、取消和重连。该目录没有 apps/server、旧 shared/ssh-client 或工作区 node_modules，缺失的包不能由开发检出补足；结束后删除临时副本。 四个原生目标的 Agent CI 使用稀疏检出，保留 Agent/SDK/domain/protocol/UI、Web、脚本以及两个用于迁移测试的桌面凭据桥文件；只安装这些工作区。编译前拒绝旧工作区、已有 dist 或可解析的 Electron/Nest 依赖。普通桌面同样不再依赖旧工作区；历史旧版对照只在冻结检出中运行。

输出目录必须是仓库外的新目录，防止误用仓库依赖验证“独立”运行。包使用官方 Node 22.22.0（核对官方 SHA-256）、对应平台已安装并通过 doctor 的 Node ABI 原生依赖、运行代码、许可证和文件校验清单，不包含 Electron。Windows 提供 `alune-agent.cmd`，POSIX 提供 `alune-agent`；只支持 Windows x64、macOS arm64/x64、Linux x64 的本机打包，不做伪交叉编译。
构建机已有该版官方发行包时，仅在 Node 可执行文件与配套 LICENSE 均逐字节匹配发布指纹时复用。否则从 nodejs.org 下载当前目标的官方归档，验证归档及解包后两份文件的 SHA-256。切换固定版本时，在独立目录核验上游签名的 SHASUMS256.txt 和四份原始归档，再用 `python3 scripts/agent/pin-runtime.py VERSION DIRECTORY` 生成 `scripts/agent/runtime-pins.json`。最终安装包内仍自带完整 Node，不依赖用户系统的 Node。


构建流程不会发布 Release。CI 在四种原生 runner 上分别打包、验证并归档，tar.gz 保留 POSIX 可执行权限。安装、升级、签名及实际远程部署仍须后续阶段验收。

## 仓库与文件读取（协议 1.2）

`repositories.inspect/discover/register/list/get/pin/openRelated/unregister` 负责本机发现、登记、收藏与打开既有 Worktree/子模块。
注销只移除登记，不删除 Git 工作区。登记复用规范化路径对应的仓库 ID，旧导入的登记与布局引用保留；SSH 登记仍显示在目录中，读取需要 P7 的主机路由。
每次查询使用 `agentId + resourceId`，不能用路径代替已登记资源，也不能将远端登记误作本机目录。

`repositories.read` 的 `kind` 包括：`status/context/worktrees/branches/remotes/stashes/stashDiff/tags/log/diff/editableDiff/diffImage/commitFiles/tree/file/blame/blameCommit/analytics/signing/signatures/submodules/lfs/snapshot`。
查询类型和返回值由 `@alune/protocol` 定义，原 `ssh-client` 导出继续转发到这些读取模块；旧写入口和 Agent 入口复用同一套 Git 业务规则。

原生 Git 以结构化 argv 执行，读取设置 `GIT_OPTIONAL_LOCKS=0`，不刷新索引。部分克隆仍可能补取对象，沿用本机代理及失败即中止规则；本地 LFS 预览只读缓存。
离线查询不要求解锁无关的 AI/账户密钥。文件读取通过文件系统端口，保留路径、符号链接、编码、大小和二进制边界。

状态查询合并相同仓库的在途任务；后台限时 10 秒，前台可提升至从任务开始计时的 120 秒。
每个调用者独立取消，最后一个调用者离开才终止共享任务；关闭会话时等待拥有的 Git 进程和文件句柄回收。
`repositories.analytics` 提供最多 20 个仓库的统计批次、3 路采集、40 项等待队列与最多 1,000 项的五分钟缓存；仅查询缓存不会触发采集。

读取结果超过 32 KiB 时分块返回，单结果最多 32 MiB，快照缓存合计最多 64 MiB / 16 项，60 秒过期。
超限或过期明确报错；不会截断为看似完整的结果。快照属于创建它的会话。
`repositories.invalidate` 使相关在途读取、统计缓存和结果快照失效，并发送带资源身份的 `repositories.changed` 通知。
混用旧写路径的客户端在写入前后调用失效接口；写入失败或断线也不会自动重放写操作。

`snapshot` 查询两次核对 HEAD 和原始索引摘要，并返回当前工作树 Git 目录和共享 common 目录。
它为 P4 提供仓库/索引校验与共享引用锁的范围；文件写入仍须另外核对目标文件内容，不能把此快照视作工作区整体事务。

隔离验收使用 `apps/web/src/api/agent-repositories.ts` 的显式查询适配器；订阅 `repositories.changed` 后按 UI 仓库 ID 映射资源。
正式桌面/Web 默认入口尚未切换，部署和远程路由遵循后续阶段。

## 仓库写入（协议 1.3）

选定 Agent 执行器后，仓库操作只投递给该 Agent。协议只接受有类型的操作名和参数，不提供任意 Git argv 或 shell 接口。目标须为本机已登记资源。受支持操作和参数见 `@alune/protocol` 的 `RepositoryWriteKind` / `RepositoryWriteArgs`；包括文件、暂存、提交、签名、分支/标签/储藏、同步、冲突/变基、子模块与 Worktree 管理。协议 1.2 和更早的会话不会公布写能力。

```ts
const intent = { resource, kind: 'stage' as const, args: [['README.md']] as [string[]] };
const revision = await client.prepareRepositoryWrite(intent);
const operationId = crypto.randomUUID(); // 投递前保存；即使响应丢失也能查询
await client.writeRepository({ ...intent, revision, operationId });
const receipt = await client.getTask({ taskId: operationId });
```

`repositories.prepareWrite` 不执行写入。执行时重新读取 HEAD、索引、refs、配置，并验证意图及操作相关的文件内容、预览令牌或确认参数。文件新增、替换与删除均受仓库路径边界限制；写文本使用 UTF-8，同目录临时文件完成写入后才替换。预览和校验不构成对外部编辑器或其他 Git 进程的全局事务。

同一 Agent 内，按登记仓库和规范化 common Git 目录拒绝重叠写入；Git 自身仍负责外部进程间的引用/索引锁。仓库变化使已登记的关联 Worktree 读缓存失效。`repositories.operation` 返回当前操作及进度；`repositories.cancelWrite` 必须同时匹配资源和 operationId。按操作 ID 的持久回执不保存文件内容、命令输出或凭据。失败、中断或超时可能已有副作用；重连后查回执与实际仓库状态，不自动重试。缺少回执不代表可以重新执行。

Web 的显式适配器支持选择测试资源；未选择资源继续走原入口。生产默认切换和远程 Agent 运行分别由 P8、P7 验收；当前独立 Agent 不托管终端，不能在旧宿主仍拥有终端的真实仓库上混用隔离夹具。

## 终端（协议 1.4）

订阅 `terminal:state`、`terminal:output`、`terminal:removed` 后，调用 `terminals.create({resource, requestId, cols, rows})`。resource 必须指向本 Agent 已登记的仓库；客户端不能指定 cwd、shell 或窗口身份。每个协议会话最多保留 8 个终端，包括已退出但未关闭的终端。通过 `terminals.list({})` 查询本窗口，`input/resize/close` 使用 sessionId；运行中的会话必须显式确认关闭。协议 1.3 及以前不公布这些方法。

协议事件 ACK 确认通道交付。xterm 解析完输出包后再发送 `terminals.ack({sessionId, sequence})`。每个终端独立等待解析 ACK，待发送输出达到 64 KiB 时暂停读取。stdio 和窗口会话在通道关闭时回收所属终端。

SSH daemon 在进程内保留 PTY 和每个终端最近约 128 KiB 输出。重新连接并订阅终端事件后，`terminals.list({})` 返回活跃终端及尺寸，`terminals.attach({sessionId})` 在同一输出流中依次交付历史与实时数据。断线期间已受理的持久写入继续执行；`tasks.reconcile({})` 返回受断线影响的任务，`tasks.get` 可按任务或请求 ID 查询回执。最后一个客户端断开且所有终端和任务结束后，daemon 开始 30 分钟空闲倒计时。重启远端 daemon 会丢失 PTY 和内存中的历史。

桌面可在已认证的仓库页面用 `?terminalExecutor=agent` 选择终端 RPC，复用已有仓库目录、SSH 通道和退出确认。独立 Agent 只运行本机仓库终端；SSH 远程 Agent 路由留给 P7。

## AI、协作与工作区（协议 1.5）

本机 Agent 读取自己的 AI 配置、命名令牌和仓库绑定。向服务商发请求的是这个 Agent；AI 请求使用本机配置的代理，PR/MR 继续直连配置的托管平台。已有配置通过上文的只读导入迁移。独立部署可以显式配置自己的服务商，握手、仓库登记和 SSH 桥接均不传输服务商密钥。

- 设置和账户沿用 `settings.ai.*`、`accounts.tokens.*`。`ai.test/models/generate/generatePullRequest` 提供连通性测试、模型获取、提交和 PR 草稿。提交生成只读取已登记仓库的暂存区，最多 96 KiB，生成后再次核对索引和配置版本。结果不会提交或推送。
- `reviews.remotes/list/detail/files/discussions/actions/applyToken/preview/mutate/create` 保留旧平台行为。调用带 `resource: {agentId, resourceId}`，其余业务参数放在 `input`。写入沿用确认时的 `revision` 和稳定的 `operationId`。丢失响应后先用 `tasks.get({taskId: operationId})` 查询回执，再核对平台事实；不可改 ID、自动重试或改走 HTTP。
- `catalog.reviews.sources/context/list` 沿用发现和列表各自的快照游标，用完整资源引用区分来源，依项目与请求编号跨页去重。来源未能发现时标记 offline，已发现的来源读取失败时标记 stale；错误和成功来源可同时出现。`workspace.groups` 仅返回连接分组与登记资源。布局、草稿、生成票据和编辑/撤销仍由客户端管理。
- 多主机协作只通过本机主机路由读取远端 Agent 的受控快照，平台凭据留在本机；旧 HTTP 宿主注入接口已移除。没有可用远端通道时显式报告离线。
- Web 接入点为 `createAgentCollaboration`，必须显式选择持有凭据的 Agent。浏览器验收可运行 `node scripts/agent/browser-reads-fixture.mjs --collaboration`，在打印的隔离页面加载 `/tests/agent-browser.ts` 的 `connectFixture()`。桌面及 Web 的默认入口不变。

## SSH 远程 Agent（协议 1.6，显式选择）

本机 Agent 用已保存的 SSH 主机配置连接目标，将同款独立包的标准输入输出接到一条 SSH exec 通道。目标不需要安装 Node、Electron 或开放业务端口。首次连接可明确选择信任服务器提供的密钥，也可预先从可信渠道获取指纹。连接成功后保存指纹，重连时强制比对。SSH 认证和本地代理凭据留在本机；远程 Agent 使用自己的持久身份、仓库登记、账户和任务回执。

1. 在目标平台用 `scripts/agent/package.mjs` 构建独立包。在本机运行 `node scripts/agent/ssh-bundle.mjs PACKAGED_AGENT LOCAL_AGENT_DATA_DIR`，将可信构建登记到对应平台。不要从远程主机接收信任清单。
2. 通过 `accounts.hosts.save` 保存主机配置。调用 SDK 时，`hostKey` 可传预先核实的 SHA-256 指纹（64 位小写十六进制），或传 `null` 明确信任首次连接的主机密钥。已有保存指纹时始终使用该指纹校验。
3. 连接时先检查系统 `alune-agent --version`。名称、发行版本和协议匹配时使用系统入口，其他情况使用用户目录中的受管包。升级和回退按目标版本自动切换。
4. 首次安装从 GitHub Release 下载并核对本机 catalog 的 SHA-256。启用本机代理时，远端下载通过 SSH 回环反向转发；若被 sshd 禁止，预装匹配版本或允许转发后重试。
5. 内网或未发版开发环境可在本机 Agent 进程设置 `ALUNE_AGENT_RELEASE_MIRROR` 为远端可访问的 HTTP(S) 静态目录。将上一步生成的 `agent.tar.gz` 以 `alune-agent-<version>-<target>.tar.gz` 发布到该目录，或把完整独立包解压并将其 bin 目录加入远端 PATH。
6. 已验证的受管包缓存在 `~/.alune-ssh/runtime/versions/<version>/<target>/`（Windows 根目录为用户配置文件夹）。缓存命中可离线启动。确认该版本的连接均已结束后，可手动删除相应版本目录释放磁盘。

```ts
const remote = await openRemoteAgent(local, {hostId, hostKey});
const repo = await remote.registerRepository(pathOnRemote);
const status = await remote.readRepository(repo.resource, 'status', {});
await remote.listRepositories(); // 刷新该主机在本机保存的目录快照
const catalog = await local.request('hosts.catalog');
remote.close();
```

旧 SSH 登记可用 `openLegacyRepository(local, remote, hostId, legacyResourceId)` 显式打开；不会把远端路径当作本机路径。Git、文件、Worktree 和 PTY 均在目标机本地执行；远端 Worktree 删除沿用当前/锁定/脏目录和忽略文件保护。本机启用代理时，SSH 和远端 Git 均经过受控代理；反向转发只接受回环来源，不在目标保存代理认证。

SSH EOF、超时或进程退出会结束该路由；目录快照保留并标为陈旧。重连创建新会话并核对上次保存的 Agent 身份，只刷新该主机的目录。写入结果不明时使用同一 Agent 的 `getTask({taskId: operationId})` 并核对仓库或平台；不要重发。原桌面和 HTTP 入口仍可显式用于迁移期恢复。

多个主机可由 SDK 的 `HostWorkspace` 管理：`connect(policy)` 建立连接，`owner(resource)` 只返回该资源的 Agent，`catalog()` 刷新已连接来源并保留离线目录。`for await (const page of workspace.reviews(query))` 按各主机独立游标推进 PR/MR 中心，按项目和编号去重，返回累计结果及不可用 Agent ID；重连后重新开始发现。


协作默认由本机持有账户：用 `await workspace.collaborationResource(remoteRepo.resource)` 取得本机别名，再以该别名调用 **local** 的 `ai.generate` / `reviews.*`。别名绑定到主机和远端登记 ID，重新登记同一路径不会继承旧账户。SSH 侧的只读快照接口仅提供已登记仓库的远端、分支和暂存摘要/差异；生成返回前再次核对暂存摘要。PR/MR 写回执向执行平台调用的本机查询。中心默认使用本机账户；显式传 `{useRemoteAccounts:true}` 才使用目标机自身的协作配置。服务器禁止反向转发时，目录、文件和离线 Git 仍可用，依赖代理的 Git 网络操作会明确失败。

## 仓库外文件与目录授权（协议 1.7）

候选 SSH 连接页的“目录授权”允许用户填写绝对目录，明确选择读取或读写。`files.grant({path, access, confirmed:true})` 返回规范目录、Agent 身份与随机授权 ID；`files.grants({})` 只列本会话的授权，`files.revoke({grant})` 立即阻止后续操作。断线、页面通道关闭或 Agent 退出会清除授权，重连后需要再次明确授权。授权不写入迁移数据库，不跨主机、窗口或会话复用。读取不会自动提升为读写。

`files.list/read/write` 使用 `{grant:{agentId,id}, path}`，path 为相对授权目录的路径；拒绝绝对路径、上级路径、符号链接/Windows junction 越界及 `.git`。写入额外要求 `content` 和最近读取的 SHA-256 `version`，新文件用 `missing`；并发写按规范路径串行校验版本，不触碰 Git 索引。UTF-8 文本读写上限 4 MiB，列举上限 10,000 条。已开始但未完成的写入报告 unknown，必须重新读取核对，不自动重放。

原 fileApi 的登记仓库流程继续使用仓库资源；仓库外路径改用明确授权的目录。旧 HTTP 接口无需授权的行为属于已接受的权限策略调整，不声明无条件等价。协议 1.6 及以前不公开这些方法。
