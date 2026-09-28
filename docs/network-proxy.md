# 网络代理

在“设置 → 应用 → 网络代理”配置 HTTP、HTTPS 或 SOCKS5 代理。修改需显式保存；关闭代理保留配置与认证信息。已保存的用户名和密码不回显，替换认证时重新填写，清除认证时关闭认证开关。改变代理主机、端口或类型后需重新填写认证，防止旧凭据被发送到另一台代理。

代理配置位于应用数据目录的 `network-proxy.json`，与 AI 服务商配置独立。桌面使用系统安全存储，独立服务复用本机 AES-256-GCM 密钥存储。认证信息加密保存；缺少密钥、配置损坏、代理故障均明确失败，不回退直连。HTTPS 代理和 HTTPS 目标分别校验证书，SOCKS5 使用代理端 DNS。系统代理、PAC 和按域名分流不在此设置范围内。

“本机”指运行 Alune 服务进程的设备。浏览器连接独立服务时，`127.0.0.1` 指服务主机；必须配置服务主机可访问的代理。Alune 内部的 HTTP / WebSocket 通信不经过出站代理。

## 生效时机

- AI 生成、模型列表、AI 连接测试、HTTP 代理测试的新请求立即读取保存的配置。
- macOS 的版本元数据、SHA256SUMS、DMG 下载和受限重定向使用同一代理。Windows / Linux 的 electron-updater 使用独立 Electron 会话，经本机桥接转发；下一次检查或下载前清理旧配置的空闲连接，保存不会取消运行中的更新任务。下载的完整性验证保持不变。
- SSH 连接保留建立时的配置快照。断线自动重连和仓库请求触发的重连仍使用这一快照；配置修改和禁用会显示“重新连接后生效”。点击“重新连接并应用”后使用最新版本。
- 重连会检查此服务器的 Git、AI、命令及文件任务；运行中任务或正在连接时拒绝重连。主仓库和关联 Worktree 共用此保护。

## 远端 Git

远端 Git 的 fetch、pull、push、读取远程引用经 SSH 回环转发复用本机代理。远端不接收代理凭据。Git 代理参数、SSH ProxyCommand 与环境只作用于当前命令，不修改远端用户全局配置；已有仓库级代理覆盖也会在命令期间被覆盖。SSH remote 保留服务器密钥验证和仓库认证，禁用控制连接复用与额外跳板，避免复用其他网络路径。

服务器需允许 `tcpip-forward` 并接受 `127.0.0.1` 监听（建议 `GatewayPorts no` 或 `clientspecified`），提供 `python3`、Git 和 OpenSSH。Linux 从 `/proc/net/tcp*` 核实监听范围；其他系统需 `netstat -an`。发现通配地址、缺少工具、权限不足或禁止转发时明确失败，关闭转发入口，不自动安装工具。Windows SSH 路径使用 PowerShell 传递当前进程环境；Windows 远端还需可在 SSH 会话中调用的 `python3`、OpenSSH 和 `netstat`。

“SSH 已连接”和“远端 Git 可用”分别显示。Git 连接测试仅读取所选仓库所有 fetch / push 地址的引用，不执行提交、fetch、pull 或 push。支持 HTTP(S) 和 SSH remote；`git://`、自定义 Git 传输助手等不允许绕过此代理。本地仓库网络操作与 PR/MR 查询沿用现有配置，不属于本设置的覆盖范围。

## 开发验证

```sh
npm run build -w @alune/shared
npm run build -w @alune/ssh-client
npm run build -w server
npm test -w server -- --runInBand proxy-settings.spec.ts
node --test packages/ssh-client/tests/proxy-transport.test.cjs apps/server/test/proxy.integration.cjs
npm run test:proxy -w desktop
```

Electron 测试使用真正的 NsisUpdater / AppImageUpdater 与 ElectronHttpExecutor、受控代理和临时下载文件，验证元数据、blockmap、SHA-512、重定向、配置变更及内部回环。测试不会安装下载文件；AppImage 使用完整下载，因为测试基线并非真实 AppImage。Linux 的 Electron 测试需图形会话或 `xvfb-run -a`。

服务端端到端测试使用临时 Git 仓库、SSH 服务、HTTP / HTTPS / SOCKS5 代理，覆盖 AI、macOS 下载及主仓库/Worktree 的真实 Git 操作。当前 SSH/Git fixture 使用 POSIX 命令，在 Windows runner 上跳过；不能据此宣称 Windows 远端已验收。测试证书与私钥仅供隔离 fixture 使用；信任仅配置在测试子进程，不改变系统信任或生产校验。

构建 web 后，可运行 `node apps/server/test/proxy-fixture.cjs` 打开控制台输出的 UI 地址；控制台同时显示一次性测试代理的地址和凭据。HTTP 与 SSH 页面测试无需真实账号，HTTPS 测试需要在启动 fixture 前为该进程设置测试证书的 `NODE_EXTRA_CA_CERTS`。退出时清理临时数据。

实际平台验证、UI 截图与未验收场景记录在 [Issue #40 Wiki](https://github.com/ShaoClean/Alune/wiki/Issue-40)。
