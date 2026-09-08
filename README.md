# RemoteGit

通过 SSH 管理远程服务器上的 Git 仓库。桌面端采用 Electron，内置 React 界面、NestJS 服务和 SQLite，无需用户安装 Node.js 或单独启动后端。

## 开发与打包

开发环境使用 Node.js 22.12+ 和 npm。首次构建需要下载 Electron 和原生依赖；原生模块没有预编译包时，需要系统 C++ 编译工具（macOS：Xcode Command Line Tools；Windows：Visual Studio C++ Build Tools 和 Python；Linux：编译工具链和 Python）。

```sh
npm install
npm run desktop:dev
```

`desktop:dev` 构建当前源码并打开桌面窗口。修改源码后重新运行该命令；前端热更新开发仍可使用 `npm run dev`，浏览器访问 `http://localhost:5173`。

```sh
npm run desktop:pack  # 生成当前系统可运行的应用目录
npm run desktop:dist  # 生成当前系统安装包
npm run desktop:test  # 构建后执行桌面集成测试
```

产物位于 `apps/desktop/release/`。macOS 生成 `.app`、DMG 和 ZIP；Windows 配置 NSIS 安装程序；Linux 配置 AppImage。请在对应系统构建和验证，原生 SQLite 模块需要匹配目标系统和架构。默认生成当前机器架构。

正式对外发布 macOS 应用还需要配置开发者签名和 Apple 公证；仓库默认可生成本机测试包。Windows 签名同样需要自行提供证书。

若本机 npm 配置禁用了安装脚本，首次启动前执行 `node node_modules/electron/install.js` 下载 Electron。构建脚本会在隔离的暂存目录中为 Electron 重建 SQLite，保留网页开发所用的 Node.js 原生模块。

## 桌面行为与数据

- 一个应用实例，重复启动会激活已有窗口；支持窗口尺寸恢复、原生菜单、缩放、全屏和复制粘贴。
- macOS 关闭窗口后仍可从 Dock 重新打开，使用 `Cmd+Q` 退出。Windows / Linux 关闭最后一个窗口即退出。
- `Cmd/Ctrl+1` 打开连接，`Cmd/Ctrl+2` 打开仓库。
- 本地服务仅监听 `127.0.0.1` 的随机端口，并要求每次启动生成的访问令牌；HTTP 和 WebSocket 请求均由 Electron 主进程自动认证。
- 页面启用沙箱和上下文隔离，禁用 Node.js 集成。界面和后端均包含在安装包中；连接远程仓库仍需要网络。
- 数据目录：macOS 为 `~/Library/Application Support/RemoteGit`；Windows 为 `%APPDATA%/RemoteGit`；Linux 通常为 `~/.config/RemoteGit`。
- 首次桌面启动时，若旧版 `~/.remote-git/remote-git.db` 存在且桌面数据库不存在，会通过 SQLite 在线备份导入。旧数据库保留；之后桌面版与网页版分别保存数据。
- 退出应用会关闭 SSH 连接、数据库与本地服务。

集成测试使用临时数据目录，验证实际 Electron 页面、深链接刷新、SQLite 增删查、HTTP / WebSocket 认证和页面沙箱，不会连接远程服务器或修改已有数据。也可用 `REMOTE_GIT_TEST_EXECUTABLE` 指定已打包应用的可执行文件进行同样的测试。
