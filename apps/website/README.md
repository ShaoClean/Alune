# Alune 官网

独立 Astro 静态站点，介绍本地与 SSH Git 工作区。现有 `apps/web` 仍承载桌面应用界面。产品首页保持静态 Astro；`/Alune/ui/` 文档通过 React / MDX 与 `@alune/ui` 展示真实组件，示例隔离在独立 iframe 中。官网不依赖 Electron、server 或共享业务包，产品首页不加载组件示例运行时。

## 本地开发与检查

在仓库根目录使用 Node.js 22.12+（CI 使用 22.22.0）和 npm：

```sh
npm ci --workspace website --include-workspace-root=false
npm run website:dev
npm run website:check
npm run website:preview
```

开发及预览地址：`http://127.0.0.1:4321/Alune/`。如需自定义端口，使用 `npm run dev -w website -- --port 4322`。

`website:check` 依次执行 Astro 类型检查、静态构建和产物完整性测试。后者验证 GitHub project Pages 下的本地资源、锚点、下载及分享链接。网站输出到 `apps/website/dist`，`.astro` 是忽略的类型与缓存目录。脚本和依赖仅在此 workspace 声明；使用根锁文件。

`npm run build` 是全项目构建，包含官网。`desktop:build`、桌面测试和发版仍只构建桌面依赖图。单独构建官网用 `website:build`；它不会构建 Electron 或 server。

## 页面与视觉维护

- `src/sections/`：首屏、工作区、改动、协作、体验和下载的文案及布局。
- `src/data/site.ts`：导航、文档与公共链接、平台安装包命名。
- `src/styles/tokens.css`：月光主题、字体、同心圆角、外壳及阴影。组件样式与组件一起维护。
- `src/styles/motion.css`：首屏文案分步入场、工作区截图与背景光晕显现、卡片悬停和按钮／链接反馈。
- `src/scripts/motion.ts`：通过 IntersectionObserver 和 Web Animations API 实现区块首次滚动显现、下载卡片错峰入场与截图切换过渡；不引入动画库或逐帧滚动监听。默认增加展示动效，系统启用减少动态效果时跳过动画，并立即取消正在播放的过渡。内容默认可见，禁用 JS 或动画 API 不可用时仍可阅读。
- 主题默认跟随系统，可手动选择浅色、深色并在本机保存。`?theme=light` / `?theme=dark` 可用于预览；手动切换后移除预览参数。
- 无 JavaScript 时，内容、下载、导航、系统主题仍可用，两张改动区截图按顺序展示。
- Geist / Geist Mono 字体通过 Fontsource 构建并自托管，中文使用系统字体回退；图标来自 Tabler Icons（MIT）。随站点发布的许可文本位于 `public/third-party-licenses.txt`。

视觉参考：[UI-Dialogs 独立 HTML](https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/issue-118/dialog-design/ui-design.html)，2026-09-30 基线 SHA-256 `97f51ecebcfceb42cb950cff1a326568827a592ddee2b4542fffeaec3ea34a33`。这是视觉规则的官网适配，参考附件中的弹窗提案不代表已发布产品行为。

## 文案、截图与品牌资产

文案按 [README](../../README.md)、[工作区说明](../../docs/workspace.md) 和稳定版核验，初始核对版本为 v0.5.2。新增描述时注意：SSH Worktree 仅支持发现和打开；代码阅读主题不影响 Diff；AI 是可选功能，会把已暂存差异发给所配置的服务；代理覆盖范围见网络代理文档。

`src/assets/screenshots/` 的五张 PNG 均直接来自 [README-Screenshots-v0.5.0](https://github.com/ShaoClean/Alune/wiki/README-Screenshots-v0.5.0)，下载原址为 `https://raw.githubusercontent.com/wiki/ShaoClean/Alune/assets/readme-v0.5.0/<文件名>.png`：

| 文件                                         | 展示内容           |
| -------------------------------------------- | ------------------ |
| `workspace-light.png` / `workspace-dark.png` | Diff、暂存与提交   |
| `repositories.png`                           | 本机／SSH 仓库列表 |
| `files.png`                                  | 文件阅读和代码主题 |
| `history.png`                                | 提交历史与分支图   |

截图对应 v0.5.0（`e86dc78d3b675084743f59c940f2ab1aafbe1ad5`），使用临时仓库、本机测试 SSH 服务和演示数据，展示网页界面，桌面窗口边框与系统对话框以实际平台为准。版本与来源记录保留在本文，页面仅提供功能描述和替代文本；构建时输出多尺寸 WebP，首屏优先加载，其余延迟加载。它们是页面实际消费的产品素材，完整设计／验收记录仍维护在 Wiki。

头像源图为 `apps/desktop/assets/alune.png`，官网的 `public/favicon.png`（64px）、`public/brand.png`（144px）、`public/og-image.png`（1200×630）由以下命令派生：

```sh
node apps/website/scripts/generate-brand.mjs
```

分享图组合既有头像、文字和真实工作区截图。中文绘制需要本机可用的中文字体；更新后需目视确认。脚本不修改源头像。

头像是基于视觉参考生成的既有素材，来源和使用权事项沿用 [#84](https://github.com/ShaoClean/Alune/issues/84)、[#87](https://github.com/ShaoClean/Alune/pull/87) 和 [Alune-Brand](https://github.com/ShaoClean/Alune/wiki/Alune-Brand) 的记录。**现有记录未确认素材使用权，不将本次接入视为授权审核已完成。** 当前使用既有头像；全身延展形象尚未生成或确认，未来选定素材放入 `src/assets/character/`，记录参考图、生成方式、确认结果和使用说明。

## 下载维护

四个平台入口都指向 `https://github.com/ShaoClean/Alune/releases/latest`，明确提示在 Release 中选择系统／芯片对应的安装包，不伪装成平台文件直链。网页不写死发布版本号，不调用 GitHub API，因此稳定版发布后无需重新构建即可进入最新 Release。若发行架构、文件命名、签名／公证状态变化，更新 `site.ts` 和 Download 区块。预发布版本不会成为 latest 下载入口。

## GitHub Pages 部署

预设地址为 `https://shaoclean.github.io/Alune/`，配置在 `astro.config.mjs` 的 `site` 与 `base`；尚未部署时该地址仅为目标地址，不代表已上线。

1. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。仓库须允许 Pages，`github-pages` 环境须允许 `development` 部署。
2. 将官网代码合入 `development` 后，网站及相关配置的变更触发 `.github/workflows/website.yml`。PR 只检查并上传产物；部署仅在 `development` push 或从该分支手动运行时执行。
3. 工作流只安装 `website` / `@alune/ui`，执行 `ui:check` 与 `website:check`，上传 `apps/website/dist`。部署使用 `pages:write` 与 OIDC，不使用个人访问令牌。
4. 部署成功后打开 HTTPS 地址，确认 HTML、`/Alune/_astro/` 下的图片、字体与脚本及分享图正常；验证下载和文档入口。
5. 公开访问验证通过后，再将仓库 About 的 Homepage 设置为上述地址。不要在站点尚未上线时填写。

如改用根域名，修改 `site` / `base`、分享 metadata 的目标及 `scripts/build.test.mjs` 对应部署断言；自定义域名还需配置 DNS 和 HTTPS。不要仅修改 README 地址。

## 验收与未完成范围

UI 修改后应复核首屏入场、滚动显现、截图切换和交互反馈，以及系统减少动态效果的即时回退。同步检查桌面／移动端布局、深浅主题、键盘操作、系统主题变化、存储不可用和无 JS 场景。更新截图后检查尺寸、加载与布局稳定性；发布前复核所有外链及最新稳定版的安装包。

设计及验收证据统一维护到 [Wiki](https://github.com/ShaoClean/Alune/wiki)，关联 [#94](https://github.com/ShaoClean/Alune/issues/94)。全身角色确认、素材使用权核对、首次公开部署与仓库 Homepage 设置完成前，不能将整个 Issue 标记为已完成。

## Alune-UI 文档与示例

公开入口：[UI 文档](https://shaoclean.github.io/Alune/ui/)。`src/data/ui.ts` 的 UIDocument 注册表驱动分类、导航、搜索与静态路径，`src/content/ui` 存放中文 MDX 指南，`src/styles/ui-docs.css` 负责文档布局。组件 API 由 `scripts/ui-api.mjs` 从真实 TypeScript 定义生成，新增能力会由覆盖检查校验。

`src/examples/*.tsx` 是运行与源码展示的唯一来源，示例 ID 在 `src/examples/registry.ts` 注册；`DemoRoot.tsx` 是运行宿主。文档路径为 `/Alune/ui/<slug>/`，独立预览为 `/Alune/ui/preview/<id>/`。iframe 支持主题、390px、重置和独立打开，来源消息只接受同源且匹配当前 iframe 的通知。正文、API 和完整源码在无 JavaScript 时可阅读。

示例使用 `src/styles/ui-examples.css` 的文档专用布局：统一展示宽度、分组、字段间距和图标网格，兼容深浅主题与窄屏。`example-*` 类只负责示例排版，不属于 `@alune/ui` 组件 API；移植示例时可替换为应用自己的布局样式。

```sh
node apps/website/scripts/ui-api.mjs
npm run ui:check
npm run website:check
```

所有 TSX 示例参与独立类型检查。静态产物测试递归校验页面、CSS 资源、深层路径、跨页锚点、canonical、重复 ID 与 aria-controls，并检查产品首页没有示例运行时。贡献与迁移说明见 [贡献指南](https://shaoclean.github.io/Alune/ui/contributing/) 和 [迁移指南](https://shaoclean.github.io/Alune/ui/migration/)。设计/验收资料维护在 [Issue #153 Wiki](https://github.com/ShaoClean/Alune/wiki/Issue-153)。
