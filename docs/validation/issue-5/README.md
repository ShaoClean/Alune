# Issue #5：已登记仓库优先展示

基线：`9c260f6`（development / v0.2.0）。验证日期：2026-09-10 至 2026-09-11。

## 实现与刷新策略

- `GET /api/repositories` 只查询本地 SQLite，返回完整的 ID、connectionId、name、path；不建立 SSH 连接，也不查询 Git。前端始终请求完整注册表，连接与搜索筛选在页面中处理。
- 复用单仓库 `/status` 接口。每个仓库独立保存请求阶段、最近一次有效数据、错误和更新时间。注册列表刷新保留状态缓存；状态响应不触碰工作区排序、折叠或布局偏好。
- 当前工作区优先，最多 3 个状态请求，其中后台最多 2 个，预留 1 个位置给当前工作区。卡片与侧栏通过 IntersectionObserver 请求可见仓库；离开可见区域会撤销尚未执行的后台请求，折叠或未滚动到的仓库按需读取。
- 缓存有效期 **60 秒**，只保存在内存。过期后显示“已过期”；再次进入可见区域时刷新。打开工作区或手动刷新不受有效期限制。失败后自动重试 **0 次**，通过“重试状态”或再次打开工作区恢复，避免离线主机反复重试。
- 单仓库服务端总时限 **10 秒**，涵盖连接与 Git；客户端时限 **12 秒**，留出传输余量。超时关闭当前 Git 命令的 SSH channel，不断开其他仓库共用的连接；连接晚到后不会再启动该次 Git 查询。
- 前后端均合并同仓库的并行状态请求，同主机的并行连接请求也会合并。切换工作区取消旧的前台请求；删除或完整注册表确认移除的仓库，其晚到状态不能恢复数据。Git 写操作之后会等待旧读取结束，再共享一次新的验证读取。
- 工作区先使用注册信息展示身份与操作入口，状态独立加载；历史、分支、远程等面板按需加载。未取得状态时显示“分支未知”和读取提示，失败时提供重试，不显示“工作区干净”。

## 性能对比

环境：macOS arm64，Node.js v25.5.0；生产构建；本机 HTTP；隔离的内存 SQLite；24 个虚构仓库，分布在 2 个连接，另有 1 个空连接。模拟第 1 个仓库耗时 800 ms，其余 23 个各 40 ms，不接触任何真实 SSH 主机或用户仓库。每组运行 3 次，以下使用中位数。

| 指标 | 改动前 | 改动后 |
| --- | ---: | ---: |
| 注册列表 HTTP 请求完成 | 1,766.83 ms | 3.49 ms |
| 全部 24 个远程状态完成（从列表请求开始计时） | 1,766.83 ms | 924.86 ms |
| 浏览器注册列表可见（从导航开始计时） | 2,004.00 ms | 211.10 ms |
| 浏览器首屏可见卡片状态完成 | 2,004.20 ms | 1,401.80 ms |

HTTP 对比使用实际基线 RepositoryService（从 Git 读取后临时转译）与修改后的 RepositoryService；改动后以 2 个并发 worker 读取全部 24 个状态。

浏览器对比使用基线与修改后各自的生产构建，Ego Lite 视口 1512 × 756，禁用该页面的 HTTP 缓存。通过 MutationObserver + requestAnimationFrame 记录注册卡片首次出现及当前视口卡片的状态完成。加入更新时间使卡片略高，改动前首屏可见 12 张卡片，改动后为 9 张；因此“首屏状态完成”不能当作相同数量仓库的吞吐对比。全部仓库的同规模对比见 HTTP 测量。浏览器调度及渲染存在抖动，原始三次记录均已保留。

原始结果：[HTTP 测量](benchmark.json)、[浏览器测量](browser-benchmark.json)、[桌面冒烟摘要](desktop-smoke.json)。这些数值仅描述上述模拟条件，不代表真实网络或大型 Git 仓库的性能承诺。

桌面端额外验证：使用 Electron 44.2.0、独立临时数据目录，先登记仓库，再冷加载 renderer（内存 store 为空）。禁用 SSH 后列表在 **78.1 ms** 内可见（最终构建复测 **83.7 ms**）；错误、网络恢复重试、再次失败保留分支和时间戳均通过。完整冒烟还覆盖实际进程重启、SQLite CRUD、认证、沙箱、排序、折叠、布局、滚动及后端关闭。

## 验收结果

| 场景 | 结果 |
| --- | --- |
| 空注册表、多连接、所有 SSH 阻塞/禁用 | 服务测试通过；浏览器离线仍展示 24 个已登记仓库 |
| 单个 Git 状态超时、其他仓库成功 | 服务 fake timers 与浏览器 10 秒真实超时均通过 |
| 连接迟到、Git channel 迟到或报错 | 不执行过期 Git；关闭迟到 channel；其他命令不受影响 |
| 首次注册列表失败及重试 | 显示明确错误与重试，不显示空列表 |
| 已有列表刷新失败 | 保留全部卡片、状态摘要与偏好，显示刷新失败 |
| 状态未知、失败、旧缓存、自然过期 | 卡片、侧栏及工作区可辨认；未知分支不显示“无分支”或“游离 HEAD” |
| 当前仓库优先、重复刷新、可见区域变化 | 队列上限、预留位置、合并及撤销未执行请求的测试通过 |
| 切换仓库、删除仓库、注册表与状态乱序 | 单元测试通过；旧状态无法覆盖新工作区或恢复删除条目 |
| Git 写操作与正在进行的读取重叠 | 等待旧读取后进行一次新读取，重复验证合并 |
| 连接筛选与排序、折叠偏好 | 浏览器筛选无匹配时侧栏仍有 24 个仓库，保存的偏好完全一致；桌面重启还原通过 |
| 扫描、添加、移除 | 服务注册 CRUD 与浏览器模拟扫描流程验证 |

相关自动测试：Web **30** 项、Repository/Connection 服务与控制器 **7** 项、SSH command **3** 项、Desktop 单元测试 **21** 项，合计 **61** 项。另执行完整桌面两阶段冒烟及浏览器验收。这里的服务端数量指相关测试文件，不代表执行了其他模块的脚手架测试。

界面证据均为虚构数据：

- [正常列表](loaded.png)
- [首载失败](first-load-error.png)
- [SSH 离线时的完整注册列表](offline-registry.png)
- [工作区状态超时](workspace-timeout.png)
- [刷新失败保留列表与旧状态](stale-cache.png)

## 重复验证

在仓库根目录执行：

```sh
npm ci
npm run build --workspace=@remote-git/shared
npm run test --workspace=@remote-git/ssh-client
npm run test --workspace=server -- --runInBand repository.service.spec.ts repository.controller.spec.ts connection.service.spec.ts
npm run test --workspace=web
npm run desktop:build
npm run desktop:test:unit
node apps/web/tests/repository-loading-fixture.cjs --benchmark
node apps/web/tests/repository-loading-fixture.cjs
```

最后一个命令输出本机临时端口。打开 `/repositories`；仅此测试 fixture 提供 `/__fixture`，可 POST `listError`、`offline`、`slowMs`、`fastMs`、`failIds`、`delayIds` 来切换模拟状态，GET 可读取虚构注册表和调用记录。该控制接口不会被打包到生产服务中。

桌面完整冒烟通常执行 `npm run desktop:test`。本次 worktree 路径包含 `.worktrees`；现有 Express `sendFile` 会将绝对路径中的隐藏目录判为 dotfile，导致启动页 404。为测试同一构建产物，将 staged app 复制到普通临时目录，未修改生产静态服务或用户数据：

```sh
repo_dir="$PWD"
smoke_dir=$(mktemp -d /tmp/remote-git-issue-5-smoke.XXXXXX)
mkdir -p "$smoke_dir/dist"
cp -R apps/desktop/dist/app "$smoke_dir/dist/app"
(cd "$smoke_dir" && node "$repo_dir/apps/desktop/scripts/smoke.mjs")
```

重建基线前端供浏览器对比：

```sh
baseline_dir=$(mktemp -d /tmp/remote-git-issue-5-baseline.XXXXXX)
git archive 9c260f6 apps/web package.json tsconfig.json | tar -x -C "$baseline_dir"
ln -s "$PWD/node_modules" "$baseline_dir/node_modules"
(cd "$baseline_dir/apps/web" && npm run build)
REMOTE_GIT_FIXTURE_WEB_ROOT="$baseline_dir/apps/web/dist" node apps/web/tests/repository-loading-fixture.cjs --legacy
```

本次不改数据库结构，不重新登记用户仓库，不保存远程状态到持久化工作区偏好。Vite 构建仍有原有的大 bundle 提示。
