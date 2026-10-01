# Alune-UI

Alune 的仓库内共享组件，包名 `@alune/ui`。React 19 / React DOM 19 / Ant Design 6 由宿主提供，源码直接交给 Vite 或 Astro 编译；首期为私有 workspace，不提供 npm 公开安装。

```tsx
import { AluneUIProvider, Button } from '@alune/ui';
import '@alune/ui/styles.css';

export function Example() {
  return (
    <AluneUIProvider theme="light" reduceMotion={false}>
      <Button type="primary">保存</Button>
    </AluneUIProvider>
  );
}
```

样式引入一次，置于宿主业务布局之前。字体由宿主加载 `@fontsource-variable/geist` 和 `@fontsource-variable/geist-mono`，缺失时使用系统字体回退。包不设置 `#root`、页面尺寸或工作区布局。Provider 拥有当前文档的主题属性、Ant Design 浮层、反馈队列和确认上下文；同一文档使用一个根 Provider，不再额外叠加 FeedbackProvider / AluneConfirmProvider。多主题独立演示使用 iframe。

`theme` 必填（`light | dark`），`reduceMotion` 默认 false；宿主负责解析系统偏好和持久化。库中不读取 localStorage，也不依赖业务 store、路由、API 或 Electron。`@alune/ui/internal` 仅用于已有应用上下文兼容与回归测试，新增调用使用公开 Provider/hook。

```sh
npm ci
npm run check -w @alune/ui
npm test -w @alune/ui
npm run website:dev
```

中文规范、组件 API、真实示例与贡献指南：[UI 文档](https://shaoclean.github.io/Alune/ui/)。实现放在 `src/components`，共享主题和控件样式放在 `src/styles`；新增导出须同时更新官网类型化注册表与真实 TSX 示例，并通过覆盖检查。基础控件直接转导出 Ant Design 原组件，保留其属性、泛型和行为；业务包装与复杂 Git 页面保留在应用。

Material Icon Theme 图标遵守 MIT，许可保留在 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。Geist 字体由宿主安装并遵守 SIL Open Font License。反馈保持已合入基线，#151 / #152 的通知策略另行演进；高频操作不要新增常规成功弹窗。

真实 Electron 弹窗回归：先运行 `npm run website:build`，启动 `npm run website:preview -- --port 4321`，再执行 `node apps/desktop/scripts/test-ui-dialogs.mjs`。覆盖 L0/L1/L2 默认焦点与恢复、Enter/Escape、文字和勾选门槛、异步失败输入保留及同事件周期重复提交。
