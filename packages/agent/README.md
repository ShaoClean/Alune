# @alune/agent

独立 Node Agent，提供会话运行时、版本化状态、配置与凭据、代理、诊断及仓库/文件/Git 读取能力。Git 写操作与终端业务按后续阶段接入；桌面默认入口保持现状。

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

独立 Node 来源使用原来的 `ai-master-key`。Electron `safe-storage:` 来源必须由旧宿主通过专用导入子进程的继承 Node IPC 解密：`apps/desktop/src/legacy-agent-secrets.cjs` 只接受宿主提供的精确密文白名单，每项一次，结束后释放。它不注册 renderer IPC 或 TCP 接口；直接运行 CLI 无法自行解密 Electron 来源。正常启动不会自动迁移真实用户数据，默认入口切换由后续阶段控制。

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
```

输出目录必须是仓库外的新目录，防止误用仓库依赖验证“独立”运行。包使用官方 Node 22.22.0（核对官方 SHA-256）、对应平台已安装并通过 doctor 的 Node ABI 原生依赖、运行代码、许可证和文件校验清单，不包含 Electron。Windows 提供 `alune-agent.cmd`，POSIX 提供 `alune-agent`；只支持 Windows x64、macOS arm64/x64、Linux x64 的本机打包，不做伪交叉编译。

构建流程不会发布 Release。CI 在四种原生 runner 上分别打包、验证并归档，tar.gz 保留 POSIX 可执行权限。安装、升级、签名及实际远程部署仍须后续阶段验收。

## 仓库与文件读取（协议 1.2）

`repositories.inspect/discover/register/list/get/pin/openRelated/unregister` 负责本机发现、登记、收藏与打开既有 Worktree/子模块。
注销只移除登记，不删除 Git 工作区。登记复用规范化路径对应的仓库 ID，旧导入的登记与布局引用保留；SSH 登记仍显示在目录中，读取需要 P7 的主机路由。
每次查询使用 `agentId + resourceId`，不能用路径代替已登记资源，也不能将远端登记误作本机目录。

`repositories.read` 的 `kind` 包括：`status/context/worktrees/branches/remotes/stashes/stashDiff/tags/log/diff/editableDiff/diffImage/commitFiles/tree/file/blame/blameCommit/analytics/signing/signatures/submodules/lfs/snapshot`。
查询类型和返回值由 `@alune/protocol` 定义，原 `ssh-client` 导出继续转发到这些读取模块；旧 Git/文件写操作保持原执行者。

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
