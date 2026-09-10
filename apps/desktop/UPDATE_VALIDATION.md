# 更新功能验收记录

日期：2026-09-10。分支：`feature/github-updater`，基线：`d1c2f4a`。

本地环境：macOS 15.5 / arm64，Node.js 25.5.0，Electron 44.2.0。应用实际版本为 1.0.0，桌面集成测试的模拟更新版本为 1.0.1。

| 检查 | 结果 |
| --- | --- |
| `npm run desktop:test:unit` | 19 项通过：SemVer、重复请求、取消/重试、校验失败、超时、IPC、安装顺序和完整发布附件校验 |
| `npm run desktop:build` | 通过：前端 TypeScript/Vite、共享包、NestJS、桌面暂存与 Electron SQLite 重建 |
| `npm run desktop:test` | 通过，退出码 0：真实设置界面、版本显示、下载期间刷新、状态恢复、沙箱/认证及后端关闭 |
| `node apps/desktop/scripts/test-packaged.mjs` | macOS arm64 打包应用通过，退出码 0；保留活跃 WebSocket 后仍能完成服务关闭 |
| 发布工作流 | YAML 已解析检查；版本标签及完整发布产物校验使用本地 fixtures 验证，未推送标签、未在 GitHub Actions 实际运行 |

本地生成 macOS arm64 DMG、ZIP 及 blockmap，文件位于 `release/`。最终打包使用已下载的同版本 Electron 目录（`--config.electronDist`）避免重复网络下载；发布工作流仍使用标准 Electron 下载流程。界面截图为 `release/update-settings.png`，其中 1.0.1 和更新说明来自模拟数据。

尚未完成的发布验收：

- GitHub 仓库仍为私有，尚无可供客户端匿名读取的正式 Release；未修改仓库可见性。
- Windows x64、Linux x64、macOS x64 未在本次本地环境构建或运行；已加入对应原生 runner 的 CI 构建和打包应用测试。
- Windows/Linux 尚未用两个真实递增版本验证安装程序启动、版本提升及原有数据保留。
- macOS 尚未从公开 Release 下载真实 DMG 并实际打开/替换安装；SHA-256、架构匹配、取消、损坏文件和超时使用测试数据验证。
- macOS 首版未签名/未公证，Windows 未配置签名。没有执行真实安装、公开发布或修改用户已有应用数据。

上述未完成项需在首次正式发布前补充版本、系统、架构和实测结果，不能以模拟测试替代。
