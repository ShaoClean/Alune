# 关键风险优先验收：2026-11-17

按用户要求调整顺序：先处理仓库写入、凭据迁移、终端退出、跨主机边界和更新回退，不继续按原编号机械开小批次。本轮 **不扣减任何 P0 ID**，第五十六批的 510 个剩余条目原样保留。**关键风险已有新增真实证据，但完整应用级升级与更新仍未验收完成，releaseEligible=false。**

平台为本地 macOS arm64；策略 `mac-arm64-local-2026-11-08`，HEAD `8f30e6bcc0a4b7706c192896a73b87dc1a915ed9`，包含此前未提交业务修改的工作树。没有修改生产实现、版本号或 hosted-only 条件，没有提交、发布或关闭 Issue。

## 本轮实际结果

| 风险 | 已验证的范围 | 证据与限制 |
| --- | --- | --- |
| 仓库写入 | 真实 Git 的 stale preview、文件/索引/共享 refs、删除确认范围、分支/stash/push/worktree/冲突恢复；提交 hook 中断后未知结果可查询、同任务不重放，重启后已提交任务不重放 | [44 项核心测试](replay-02/writes-terminals-migration-boundaries.log)和[独立包](replay-02/packaged-agent.log)；操作隔离仓库 |
| 凭据迁移 | 已发布 v0.11.0 随包令牌/AI/代理模块 + 真实 Electron safeStorage → 私有继承 IPC → 当前 Agent 的隔离 Keychain；无解密授权拒绝且无部分导入、重复导入不再次解密；完整合成旧资料目录备份逐字核对、销毁后恢复并用发布模块解密 | [原生结果](native-03/node-result.json)、[旧模块恢复](native-03/electron-result.json)、[来源](native-03/proof.json)；不是未修改旧应用的整机升级 |
| 凭据恢复 | 2 个主机/2 个仓库/1 个令牌及绑定、4 个文档，覆盖 SSH 密码、私钥口令、令牌、AI 密钥、代理密码和工作区；目的 Keychain 原密钥及身份丢失后，从加密备份恢复并新建原生密钥；错恢复口令不改现状、仓库与旧资料 bytes 不变 | [原生结果](native-03/node-result.json)；源备份不包括旧 safeStorage 系统密钥，旧模块回读期间该专用源密钥仍存在 |
| 终端退出 | 真 PTY 的输入/resize/ACK/退出、EOF 与 Agent SIGKILL 后前台进程回收、重启无旧会话；另有确认、连接 owner、事件与取消的成对生命周期断言 | [44 项核心测试](replay-02/writes-terminals-migration-boundaries.log)、[独立包](replay-02/packaged-agent.log)及[SSH](replay-02/encrypted-ssh.log) |
| 跨主机边界 | 两个独立打包 Agent 与随包 SDK 经真实加密 loopback SSH；pin/install、资源身份、只读/写入授权、越界/跨 Agent 拒绝、撤销、断线后显式重连、未知写入不重放、损坏升级拒绝 | [SSH 实际日志](replay-02/encrypted-ssh.log)；两个端点均在本 Mac，不代表任意外部主机 |
| 更新与回退回归 | 33 项测试覆盖 SemVer、来源/校验、下载取消与重试、退出确认/清理超时、真实 helper 替换/失败回退、原生 DMG 与 `/usr/bin/open` 启动夹具 | [测试日志](replay-02/update-rollback.log)；测试中的受控 transport/launcher 明确保留 |
| 生产更新下载 | 当前生产 updater 实际访问 GitHub 公共更新 API，发现 v0.11.0，下载完整 157,111,828 bytes，核对发布 SHA-256，真实挂载、检查身份/架构/版本及 ditto 暂存 | [最终证明](live-update-02/proof.json)；调用时当前版本仅作为 `0.11.0-rc.1` 输入，没有改项目版本或发布构建，也没有执行应用替换/启动 |
| 原生失败回退 | 真实已发布 DMG 暂存/替换后，明确注入第一次 launcher 拒绝；恢复原生夹具的原 plist 与 Mach-O bytes，实际用 `/usr/bin/open` 启动恢复后的旧夹具，独立启动文件证明已运行；设置 bytes 不变，错误读出后被消费 | [原生回退结果](native-rollback-01/result.json)、[尝试顺序](native-rollback-01/attempted-versions.txt)、[实际启动](native-rollback-01/restored-startup.json)；原应用是 C 原生夹具，发布 Alune 新进程未启动，不作完整应用升级通过声明 |

核心测试 **44/44**，更新回退测试 **33/33**，两组 failed/cancelled/skipped/todo 均为 0。随后实际完成独立 package、随包 Node/SQLite/PTY/临时 Keychain 测试和隔离加密 SSH 场景。[执行记录](replay-02/execution.json)、[输入封存](replay-02/source-before.json)、[dirty 包清单](replay-02/package-manifest.json)、[结果](replay-02/result.json)保留。验收进程用 Node 22.22.0；本地含头文件的 Node 26.12.0 执行 N-API v8 原生构建脚本。包是临时产物，测试完已移除，不宣称干净发布包。

原生迁移先验证发布 DMG 校验和 `c12e18d92c1b901645f274ef7e73dd052249a0f1f64f26faf5f59cf98761a554`，重新只读挂载并比较安装副本的 **523 个文件/链接**，再加载其中真实模块与原生依赖。ASAR SHA-256 为 `dba5cf33b42cf90f49180a0ed2e76aba9a16e85b6ebb3ae367680f1471e143f6`，与生产 updater 下载后暂存及原生回退的 ASAR 一致。使用独有 `Alune Critical <UUID>` 应用身份，结束删除对应 safeStorage 项、目的临时 Keychain 和所有合成资料，见[清理记录](native-03/execution.json)。未访问日常 Alune 资料、账户或原凭据。

## 仍需先完成的应用级门槛

1. **installed-upgrade-rollback**：未修改的已发布旧应用，以正常应用身份启动，在完整旧用户资料与系统凭据环境中升级到当前安装包，再从迁移前完整备份正常回退，核对资料、凭据可用与 Git 不变。本轮旧发布模块的回读不能替代旧应用启动。
2. **darwin-arm64:native-update**：安装的当前候选应用通过真实 updater 退出、替换，随后独立观察更新后 Alune 的版本、packaged startup 和状态。单独调用 adapter 下载/暂存及原生夹具启动不能替代这个过程。

发布 v0.11.0 的 `main.cjs` 正常启动固定使用 `Alune` 身份及日常 `Application Support/Alune`；只有 smoke 入口允许指定测试数据目录，且会启动自带 smoke 流程。要做上述未修改发布应用的正常系统凭据演练，需要一次性隔离 Mac 用户环境，或经过单独验证的完整本地隔离入口；本轮没有伪造 hosted/CI 标记，也没有把模块夹具改标为该 gate 通过。后续应继续解决这两个门槛，不能因本轮风险回归成功而回到只读数字补验。完整 P0、干净当前发布构建、适用性能等既有条件也继续保留。

## 失败记录与保全

- `replay-01`：原生构建检查因随包 Node 无头文件退出；未进入功能测试。改用本地含头文件 Node 后完整 `replay-02` 通过。
- `native-01`：测试误把 password 认证主机上不使用的私钥口令当作有效 credential；新增独立 privateKey 主机，另断言 password 主机不暴露无效口令。
- `native-02`：迁移及原生恢复已经执行，但计数包含旧模块绑定前的解密；在正式私有导入前重置计数，完整 `native-03` 通过。没有放宽业务断言。
- `live-update-01`：下载与暂存已通过；发现日志记录了临时签名重定向 query，已移除 query 并留[脱敏说明](live-update-01/redaction.json)。修正驱动为请求时就不记录 query，再完整执行 `live-update-02`。不保存签名 URL。

首次工作区写入前封存 [9,237 个已有普通文件](preservation-before.json)，包括此前验收证据与未提交代码。[最终核验](verification.json)检查本轮输入/输出、哈希、原文件保全及门槛限制；不重写先前批次证据。本批不修复也不消除第三十六批已记录的历史 `.DS_Store` 保全失败。旧历史的 fullPreservationVerified=false 结论继续保留。

重放工具：[关键回归](../../../../scripts/agent/critical-mac-acceptance.mjs)、[发布模块原生迁移](../../../../apps/desktop/scripts/critical-native-migration.mjs)、[生产 updater 下载](../../../../apps/desktop/scripts/critical-live-mac-update.mjs)、[原生失败回退](../../../../apps/desktop/scripts/critical-native-rollback.mjs)。每次必须给不存在的新输出目录；回执不合并进完整发布 gate，不自动关联原 P0 条目。
