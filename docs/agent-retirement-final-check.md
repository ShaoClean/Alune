# 删旧前最终检查（2026-11-08）

## 结论

**本轮工程安全项已通过；两轮历史性能 80/80 可以限定复用；整体仍不放行删旧。**

本轮仅要求当前 **macOS arm64**，依据 [Mac 本地验收策略](agent-mac-acceptance.md)。Windows x64、Linux x64、macOS x64 延期，不算通过，也不再拿旧四平台缺失阻塞本轮。GitHub Actions 不是本轮前置条件。

尚未满足的是：完整 P0 逐项功能断言审查、当前 Mac 的真实安装/升级/原生更新/回退、切换前完整备份及恢复演练。**同日后续已修复分支切换焦点问题，完整非 focused 原生 write/restore 均通过**，详见[焦点修复与完整原生回归](branch-picker-focus-regression.md)；该结果不替代剩余产品级门槛。本轮没有切换默认入口、停止日常写者、删除旧实现或修改日常应用数据。

## 来源与运行包一致性

- 本轮源码 HEAD：`8d3441768ac1acfb4f08a03c0c27e3345c9d8bf2`。
- 当前 Agent 包：`apps/desktop/dist/agent-runtime`；manifest 标记来源同 HEAD、打包时 `dirty=false`，目标 `darwin-arm64`，随包 Node `22.22.0`。
- 当前 manifest SHA256：`6880ba94a13c90e6e197165c307164a5e6910d9f3538dbe418121160403b9b40`。
- 当前包 **1,821/1,821 文件**符合自身 manifest；协议、领域、SDK、Agent 四个工作区共 720 个包内文件已对照当前工作区。
- 对四个核心工作区执行 `tsc -b --force` 后，**179 个 JS/JSON/native 运行产物指纹与重建前完全相同**，与包内运行文件一致。
- 强制重建后唯一非运行差异是 `modules/git/actions.d.ts` 的联合类型顺序：`"local" | "ssh"` 与 `"ssh" | "local"`。不将它冒充全文件字节一致，也不据此重跑性能；包本身完整性仍通过。
- 当前工作树含本轮前已有的未提交验收驱动改动；首次工程检查额外修改了 `packages/agent/tests/hosts.test.cjs` 的夹具取值、本报告及验收策略文档的报告链接。同日后续另修复前端焦点恢复和原生输入驱动，来源以各轮 `source-state.json`、源码副本及构建哈希为准，未冒充干净 checkout 放行。

[重建前输入](../.claude/retirement-final-20261108/inputs-before.json)、[强制重建后输入及差异](../.claude/retirement-final-20261108/inputs-after.json)、[实际包 manifest 副本](../.claude/retirement-final-20261108/agent-package-manifest.json)、[声明文件差异](../.claude/retirement-final-20261108/declaration-difference.patch)。

## 本轮执行结果

| 检查 | 结果与断言边界 | 证据 |
|---|---|---|
| 协议协商兼容 | **通过**。真实打包 Agent、本地 stdio，1.0–1.7 八级；当前 85 个方法，270 次后续版本方法拒绝；未来 minor 降至 7，不兼容 major 拒绝，协商前不得调用健康检查。不是全部历史 HTTP 路由的新执行。 | [协议回执](../.claude/retirement-final-20261108/protocol.json) |
| 打包后的本地执行 | **通过**。SQLite/PTY、临时 Keychain、注册/status/diff/log/file、真实 stage/commit、身份与设置 revision/任务回执跨重启保留；仓库外运行时不能解析 Electron/server/web/旧 ssh-client。 | [隔离本地包日志](../.claude/retirement-final-20261108/packaged-isolated.log) |
| 本地与 SSH 行为一致性 | **通过**。真实加密 SSH 对端、两个随包 Agent 与随包 SDK，主机 pin、显式安装、仓库状态一致、Worktree 删除保护、子模块、代理 fetch、授权文件读写/越界/撤销/跨主机隔离。对端为本机隔离夹具，不声称任意真实服务器或其它 OS 已验收。 | [隔离 SSH 日志](../.claude/retirement-final-20261108/ssh-isolated.log) |
| 终端 | **通过**。真实 PTY、正确 cwd、输入/resize/退出码/关闭确认；两终端独立消费 ACK，慢消费者不阻塞另一终端，输出有序、有界，关闭后不可用旧 ACK 复活。EOF 或 Agent 崩溃后回收前台进程。 | [随包核心测试](../.claude/retirement-final-20261108/bundled-core-final.log)、本地/SSH 日志 |
| 断线恢复 | **通过**。SSH 中断时写操作返回 `unknown`；目录保留但标 stale，另一个主机不受影响；显式重连保持 Agent 身份、恢复既有任务回执、清除 stale。**不承诺恢复旧终端会话**：旧会话失效、重启列表为空，旧 session 输入被拒绝。 | 隔离 SSH 日志；随包核心测试中的 `terminals`、`state`、`task-journal` |
| 重复写入防护 | **通过**。客户端取消/超时不重发；崩溃中的操作持久化为 unknown，不停留 running；旧 operationId/requestId 重放被拒绝。本地提交数仍为 2，SSH 中断 fetch 的上游触发次数仍为 2，崩溃夹具仅写一次；设置 CAS 与单写者锁通过。`unknown` 仍须查询回执与实际仓库/平台状态，不等于未发生。 | 本地/SSH 日志；随包核心测试中的 `process`、`task-journal`、`state`、SDK 测试 |
| 旧数据迁移与备份恢复 | **通过夹具级验证**。旧数据只读导入、重复导入不重复写、取消/中断不发布半成品；加密 recovery 封装恢复身份、数据库、偏好及 SSH/访问令牌/AI/代理凭据，旧本地主密钥丢失后生成新保护记录。错误口令、篡改、取消、外来身份和活动写者均拒绝；保留旧数据代际，不碰仓库字节。Mac 原生恢复使用临时 Keychain，未访问日常登录 Keychain。 | 随包核心测试中的 `legacy-import`、`legacy-cli`、`recovery*`、`state*` |
| 源码 Agent + SDK 测试 | **130 通过，0 失败，3 跳过（共 133）**。使用本机 Node `26.12.0`；跳过 Windows DPAPI、非 Mac 的 headless 平台保护检查、未指定冻结对照目录的 pre-P3 查询对照，不计为通过。 | [完整日志](../.claude/retirement-final-20261108/agent-tests-rerun.log) |
| 随包 Node 核心复验 | **64/64，0 跳过**。仓库外隔离运行，Node `22.22.0` 和依赖均来自原包；15 个测试文件覆盖协议/SDK、任务、单写者、迁移、完整恢复、主机凭据及真实终端。迁移 CLI 测试仅另复制两个不依赖 Electron 的旧 safeStorage IPC 桥接夹具，不带旧执行器。 | [日志](../.claude/retirement-final-20261108/bundled-core-final.log)、[运行脚本](../.claude/retirement-final-20261108/run-bundled-core.mjs) |
| 回执策略与证据工具 | **14/14 通过**，源码引用、focused、旧 SHA、未完成 restore 都不能伪造当前完整验收；新旧依赖边界检查通过。 | [工具测试](../.claude/retirement-final-20261108/evidence-tools.log)、[边界检查](../.claude/retirement-final-20261108/boundaries.log) |

源码测试与随包测试有重复覆盖，**不可相加为 194 个独立场景**。同样，协议、HTTP、共享模型、UI 回调是不同验收维度，不互相顶替。

### 本轮发现与保留的失败

1. 首次源码测试为 129 通过、1 失败、3 跳过：主机夹具用排序后的 `.at(-1)` 返回“新建主机”。同毫秒创建时按随机 ID 排序，可能返回原主机，使凭据串换测试变成自我替换。现按新增 ID 集合精确取值，**没有改变生产凭据代码或放松安全断言**。修正后全套 130 通过，单文件再验 2/2；补丁保留在 [夹具补丁](../.claude/retirement-final-20261108/hosts-test-fixture.patch)。
2. 直接在 checkout 内检查包时向上解析到旧依赖，隔离性断言失败；改为把**同 manifest、同文件字节**的包复制到新建仓库外目录后，原检查完整通过。未修改包或跳过断言。
3. 额外随包测试驱动最初把 `/var` 与真实路径 `/private/var` 比较，并漏复制迁移 CLI 显式依赖的两个桥接夹具；这些驱动准备失败保留原日志，补齐后 64/64。不是业务错误，也不当作成功执行。
4. 首次强制重建对账因上述 `.d.ts` 联合顺序不同退出非零。归档中保留原差异；最终按完整包完整性、运行文件一致性、声明差异分别报告，不称全部工作区字节相同。

所有早期失败日志保留在 [本轮归档索引](../.claude/retirement-final-20261108/archive-index.json)，未用成功重跑覆盖。

## 性能：保留原 SHA 的两轮 80/80，不重复采样

原始测量 SHA 为 **`4c2770f64a088291fc172499ff3ef5ec6b5ccea3`**，`dirty=false`；冻结对照为 `3c05f640fcc1a04c864e47bfc2880483ad48c984`。**不是本轮 HEAD 的新性能执行。**

| 原始测量 | 阈值结果 | 原始报告 SHA256 |
|---|---:|---|
| 2026-11-07 第 1 轮 | **80/80** | `1479253528a018bdb7183b3dc67a22abf15060b95b9493472d656fb8c72b222d` |
| 2026-11-07 第 2 轮 | **80/80** | `fd7b1ad201fc585e0b4ff4d90dcd86eafd74c71a617b72a8b2323f87f9916d01` |

复用依据已在本轮核对并归档：

- 历史计时包和当前包各自 1,821 个文件均符合各自 manifest，**两份 `manifest.files` 映射完全相同**；随包 Node 与固定 runtime 输入相同。manifest 本身因来源 SHA 不同而不同。
- 从历史测量提交到当前 HEAD，以及从 HEAD 到工作树，计时涉及的 Agent/SDK/domain/protocol 生产代码、旧 server/ssh-client 对照代码、依赖锁、构建配置、打包/runtime 输入、`scripts/agent-baseline.cjs`、`scripts/agent/ui-benchmark-worker.cjs` 未变。
- 当前核心强制重编译未改变运行字节；工程检查修正测试取值，同日后续修复前端焦点恢复及验收驱动，均不触及已测性能路径。Chromium 渲染原本不在计时范围内，不借此前端分支焦点和代码视图变化宣称 UI 渲染性能等价。
- 每轮覆盖 small / many-files / large-file / lfs，候选/基线各 20 冷 + 20 热；冷指新进程，**未清 OS 页缓存**。测量范围是传输/Git/PTY/RSS/退出残留，不包含 SSH 性能、Chromium 渲染或其他平台。
- 历史报告未嵌入完整包 digest、完整命令/环境、计时驱动指纹和冻结对照 dist 指纹。同包关系有同期打包/SSH 日志及后续等价记录补强；本轮事后哈希不能补写成当时已有的完整溯源。此局限保留，不伪造执行记录。

[复用核验与原始文件来源](../.claude/retirement-final-20261108/performance-reuse.json)、[第一轮](../.claude/retirement-final-20261108/performance/4c2770f-performance-1.json)、[第二轮](../.claude/retirement-final-20261108/performance/4c2770f-performance-2.json)、[两轮汇总](../.claude/retirement-final-20261108/performance/4c2770f-performance-two-rounds.json)。原始文件已从临时 Wiki 工作副本复制入本轮本地归档，保留原字节。

**后续只有影响已测运行路径、传输/依赖、驱动/夹具、对照或阈值的变动才重新测量相关性能；纯文档/测试修正不触发无意义重跑。**

## 仍阻止删旧的门槛

### 1. 完整 P0 逐项断言审查尚未完成；原生 write/restore 已通过

- 原始 P0 台账仍为 2,758 个 ID，其中 UI 原始 ID 为 888，不删台账消缺口。
- 历史 UI 关联 628，原缺口 260；其中 17 个不同 ID 已确认**限定部分断言**，不能报告成 645/888 全部通过。
- 同日后续的[新增轨迹对账](../.claude/acceptance-20261108/ui-reconciliation-focus-fix.json)保留原有审查记录：其余 243 项中，2 项新增完整执行轨迹但待逐 ID 审查、129 映射待审、90 需补测、4 已有断言待重跑、18 未接线/隐藏契约待审；`releaseEligible=false`。
- 历史 `full-v3` 在切回 main 后焦点恢复失败、restore 未执行的证据保留。修复后 `full-focus-fix-v1` 越过该阻塞，再停于原生 Enter 送达；补齐真实按键送达核对后，**`full-focus-fix-v2` 完整通过**：`focus=null`、退出码 0、write 与 restore 都有成功完成标记，184 条工作区场景加 19 条分阶段断言，共 203 条场景回执。没有放松焦点、键盘或数据保护断言。
- [完整回归汇总](../.claude/acceptance-20261108/full-focus-fix-v2/regression-summary.json)及[哈希索引](../.claude/acceptance-20261108/full-focus-fix-v2/regression-index.json)记录实际未提交来源、构建资源和原 Agent 包一致性。Web 单测 346/346、桌面单测 58/58；项目 Node 22 下通过，早期 Node 26 测试加载器失败仍保留，不声称已修复该兼容性。
- [本轮 UI-only 回执](../.claude/acceptance-20261108/full-focus-fix-v2-receipts/receipts.json)自动关联 646 个 P0 ID，不是 646 项完整功能通过。[Mac 策略报告](../.claude/acceptance-20261108/full-focus-fix-v2-receipts/gate-missing.json)仍未放行，2,112 个 ID 未被该输入关联；其中列出的工程 gate 缺失表示这些独立回执未混入 UI-only 输入，不代表上述工程测试失败。
- [先前 UI 逐项报告](../.claude/acceptance-20261108/UI-RECONCILIATION.md)与[先前机器回执](../.claude/acceptance-20261108/ui-reconciliation.json)保留原样，不把新增执行轨迹自动改写为已审通过。

### 2. 当前 Mac 真实安装/升级/原生更新/回退尚未验收

- 本轮没有当前候选包的真实 Mac 新装、旧版升级、原生下载/重启安装/重启后核对、回退完整回执。
- 已有历史 native-release-cycle 记录来自其它提交；当前 `updates-v3` 只调用 smoke adapter，不等于真实更新。
- 历史日志保留了原版/候选安装器 SHA256 和 artifact 元数据，但当前验收归档没有离线安装器二进制，也未确认远端附件仍可下载。
- 当前包的 `dirty=false` 元数据及本轮强制重编译不等于当前完整候选的干净 checkout 构建/安装验收。

### 3. 切换前的实际完整备份及恢复演练尚未完成

- 本轮恢复验证全部使用隔离临时夹具；**未制作或宣称已验证用户实际迁移前备份**。
- 数据库快照只保护数据库；完整身份和凭据恢复必须使用加密 recovery 封装，并保留旧数据库/偏好、旧可运行安装器、写回执和恢复说明。
- 实际切换仍须确认唯一写者、备份可读及可恢复、SSH 授权重新确认；数据库/凭据恢复不会撤销已落地 Git、文件或平台副作用。`unknown` 不允许自动重发。

### 4. 尚无当前 Mac 策略下的完整最终放行回执

不能把不同 SHA、不同输入范围的旧 gate-missing 报告拼接成新通过。补齐以上门槛后，须针对完整 P0 与 `mac-arm64-local-2026-11-08` 策略执行最终对账，保留真实 SHA、dirty 输入和证据哈希。

只有删旧前门槛真正通过后，才进入停止旧写者、保留已验证备份、切换桌面/Web 默认入口及退役旧实现；**删旧后仍需干净源码重建和第二轮完整 Mac 回归独立归档**，本报告不替代该轮。

## 归档与操作状态

首次工程检查证据在 `.claude/retirement-final-20261108/`；同日后续焦点修复及完整原生回归证据在 `.claude/acceptance-20261108/full-focus-fix-v2/`，另有对应 UI 回执及新增轨迹对账。目录受当前忽略规则影响，**本地存在不等于已提交或已发布**。原始日志、失败、包 manifest、源码/产物指纹、测试补丁、性能来源及哈希索引均保留；本报告后续更新不回写历史执行与历史归档。本轮未提交、未推送、未发布 Wiki，未删除任何旧入口或备份。
