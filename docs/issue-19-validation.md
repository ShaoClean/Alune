# 新增文件删除：实现与验收

Issue：<https://github.com/ShaoClean/remote-git/issues/19>

基线：`development@6c1e6be`；验证日期：2026-09-15。

## 行为

- 未跟踪、新增已暂存及新增混合改动的行提供「删除整个新增文件」。混合改动另有「丢弃未暂存改动」，恢复暂存区版本。
- 打开确认框时读取远端最新状态、文件摘要及暂存记录，展示完整相对路径、删除范围和「直接删除，不进入回收站」。取消不执行删除或取消暂存。
- 确认时重新核验状态摘要；内容、暂存区或分支发生变化时拒绝旧确认。仅处理仓库内一个文件，拒绝目录、子模块、已跟踪文件、越界路径及带符号链接的父目录。文件本身是符号链接时只删除链接。
- 暂存新增文件先使用字面路径清理该路径的索引，再通过 SFTP `unlink` 删除磁盘文件，保留空父目录。支持尚无首次提交、intent-to-add、强制暂存的忽略文件，以及磁盘文件/父目录已消失而索引仍存在的情况。
- 删除期间阻止重复提交；成功和失败均刷新实际状态，并清除当前文件的 Diff 及未完成的旧 Diff 请求。混合改动分组分别展示，总文件数按路径去重。
- Git 状态使用 porcelain v2、NUL 分隔及完整未跟踪文件列表；SSH 字符串解码保留跨分包的 UTF-8 字符。

## 验证

环境：macOS、Node.js 25.5.0、系统 Git。所有测试仓库均使用临时目录，不涉及用户远端仓库。

```sh
npm run build -w @remote-git/shared
npm run test -w @remote-git/ssh-client
npm run build -w server
npm run build -w web
npm run test -w server -- --runInBand new-file-deletion.spec.ts repository.service.spec.ts
npm run test -w web
```

- SSH/Git/磁盘测试：33 项。既有本地 Git/文件系统适配测试，也有通过 `ssh2.Server` 在回环地址建立真实 SSH/SFTP 连接的测试。覆盖未跟踪、暂存、混合改动、无 HEAD、特殊路径、符号链接、只读目录、索引锁、断连、并发重新暂存/创建及部分失败后重试。
- 服务端目标测试：8 项，覆盖真实 Nest HTTP 路由、请求校验、错误原因和状态码、重复请求拦截及仓库状态回归。
- Web 测试：35 项，包含删除预览后对延迟 Diff 响应的失效处理及原有工作区测试。
- 前后端构建通过。Vite 仍提示主 bundle 大于 500 kB。
- ego-browser 配合真实 GitService/Git/磁盘的隔离 fixture 验证：键盘打开/确认、取消后磁盘和索引不变、暂存/取消暂存回归、丢弃未暂存内容保留暂存版本、删除混合内容后计数和 Diff 更新、重复点击仅一个请求、特殊文件名及父目录保留、权限失败反馈/重试、外部修改导致旧确认失效。

界面复验入口（先完成上述构建）：

```sh
node apps/web/tests/new-file-deletion-fixture.cjs
```

打开命令输出的本地地址，进入「新增文件删除验收」。退出 fixture 时清理临时仓库。

## 已知限制与基线问题

- Git 索引与 SFTP 文件删除不是跨步骤原子事务。发生错误时分别报告磁盘文件和暂存记录的实际结果；连接中断无法核验时明确显示「无法确认」。不会自动回写旧索引覆盖其他工具的改动。本进程的删除锁不约束外部 Git/文件系统写入。
- Windows SSH 的 Git 参数使用编码 PowerShell 和原始字节流转发，已有参数/路径防护测试；本次未连接实际 Windows SSH 主机验收。
- 全量 `npm run test -w server -- --runInBand` 中 5 个原有占位测试缺少依赖注入配置而失败：`connection.controller.spec.ts`、`file.controller.spec.ts`、`file.service.spec.ts`、`git.controller.spec.ts`、`git.service.spec.ts`。原始 worktree 中同样可复现；本次新增功能测试通过。
