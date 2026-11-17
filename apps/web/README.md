# Alune Web

基于 React、TypeScript 和 Vite 的工作区界面，通过 `@alune/agent-client` 连接独立 Agent；共享组件来自 `@alune/ui`。

在仓库根目录运行：

```sh
npm run dev           # 构建 Agent 和共享组件并启动本机 Web 工作区
npm test -w web       # 前端回归测试
npm run build -w web  # 类型检查与生产构建
```

开发服务使用终端显示的完整邀请链接。环境准备、桌面集成及测试说明见[开发与打包](../../docs/development.md)，界面操作见[工作区使用说明](../../docs/workspace.md)，共享组件见[Alune-UI](../../packages/ui/README.md)。
