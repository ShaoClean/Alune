# @alune/agent

独立 Node Agent。当前提供会话运行时和核心诊断协议；Git、文件、终端业务及配置迁移仍按后续阶段接入。它没有切换桌面默认入口。

CLI、握手和独立包的应用版本在构建时读取根 package.json，遵循仓库唯一版本来源；workspace 包自身版本不作为对外发行版本。

```sh
npm run build -w @alune/agent
node packages/agent/bin/alune-agent.cjs version
node packages/agent/bin/alune-agent.cjs doctor
node packages/agent/bin/alune-agent.cjs serve --data-dir /path/to/agent-data
```

`doctor` 实际执行临时内存 SQLite 查询、Node 子进程 PTY 和 Git 版本探测；缺少依赖时输出诊断并以非零码退出。`serve` 的 stdout 只允许 NDJSON 协议，错误写 stderr；不能用交互式调试输出污染 stdout。

`serve` 首先要求 `initialize`，随后提供 `agent.health`、`agent.version`、`agent.capabilities`、`events.subscribe`、`events.ack`、`requests.cancel` 和 `tasks.get`。初始化返回明确能力集，未知方法或不同协议 major 被拒绝。`agentId` 保存到数据目录的 identity.json；sessionId 每次启动改变。损坏身份文件拒绝启动，不静默重新生成 ID。

首期只有会话模式。EOF、信号或协议错误关闭会话，取消运行中任务并调用资源回收；超出退出期限或回收失败以非零码退出。任务记录只保留当前会话最近 1,024 项，不支持跨重启恢复；记录被淘汰或未找到不授权重放写操作。同一通道 requestId 使用固定前缀和严格递增序号，重复/倒退 ID 关闭通道；只需保存序号上界即可拒绝历史重放，不随请求总量累积 ID，也不强制每 4,096 次请求断线。同时最多 64 个业务任务，超限明确拒绝且不自动重放。

业务处理器通过 `Handler` 端口注册，声明 query/mutation、参数校验和执行函数。每次执行分配 taskId，可用 requestId 或 taskId 查询当前会话状态。写任务取消/断线可能已有副作用，不能把请求取消当作回滚；未知结果需要核对仓库事实。

事件可靠流使用 `events.write(...)` 并等待消费方 ACK；可传 AbortSignal，生产者不能忽略 Promise 而无限发送。状态通知使用 `notifyState`，合并/溢出后发送 `events.resync-required`，消费者据此重新读取快照。队列按 UTF-8 字节数和条目数限额，预留控制消息空间；每个事件必须分块到 64 KiB 以下。ACK 超时终止会话。

目录职责：`cli` 命令、`bootstrap` 装配/stdio 退出协调、`server` 会话分发、`runtime` 共享任务/事件机制、`ports` 处理器和事件端口、`adapters` 主机身份与原生诊断。后续 `modules` 放业务规则，通过 ports 访问适配器；不引入 Electron/Nest 控制器依赖。

运行 `npm test -w @alune/agent`，包括真实子进程、取消/断线/重复写、ACK/重同步、SQLite/PTY 与身份生命周期。

## 状态存储基础

`serve` 现在打开 Agent 自己的数据目录，不自动读取或迁移旧桌面/服务端数据库。SQLite 进程写锁保证同一数据目录只有一个写者，崩溃后由操作系统释放锁；数据使用经过版本/结构/身份校验的数据库目录和原子指针。

协议 1.1 提供 `storage.status` 和 `storage.backupDatabase`，Client 对应 `storageStatus()`、`backupDatabase()`。协议 1.0 会话只保留原有能力。

```sh
node packages/agent/bin/alune-agent.cjs state-backup --data-dir /path/to/agent-data
node packages/agent/bin/alune-agent.cjs state-restore --data-dir /path/to/agent-data --backup /path/to/backup
```

这些命令当前仅处理新 Agent 的状态数据库，明确返回 `database-only`；它们不是旧配置/凭据的完整迁移或导出工具。恢复要求服务停止并取得写锁，校验备份散列/版本/Agent 身份后切换到新的数据库目录，保留旧目录及损坏指针，不修改仓库或未提交文件。缺少/损坏身份不会被静默替换。

POSIX 使用用户专有权限；Windows 使用内置 PowerShell 设置当前用户与 SYSTEM 的受保护 DACL，子进程有超时与取消。修订冲突、损坏/未来版本、软链接/目录联接和硬链接不以创建空状态掩盖。当前持久操作表只是基础结构，RPC 任务尚未接入持久日志；账户、OS 凭据、旧数据导入、代理与日志迁移仍在 P2 中推进。

## 独立运行包

```sh
node scripts/agent/package.mjs --output /tmp/alune-agent-package
node scripts/agent/test-packaged.mjs /tmp/alune-agent-package
```

输出目录必须是仓库外的新目录，防止误用仓库依赖验证“独立”运行。包使用官方 Node 22.22.0（核对官方 SHA-256）、对应平台已安装并通过 doctor 的 Node ABI 原生依赖、运行代码、许可证和文件校验清单，不包含 Electron。Windows 提供 `alune-agent.cmd`，POSIX 提供 `alune-agent`；只支持 Windows x64、macOS arm64/x64、Linux x64 的本机打包，不做伪交叉编译。

构建流程不会发布 Release。CI 在四种原生 runner 上分别打包、验证并归档，tar.gz 保留 POSIX 可执行权限。安装、升级、签名及实际远程部署仍须后续阶段验收。
