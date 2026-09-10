# 贡献与发布指南

RemoteGit 使用 Conventional Commits 描述变更，commitlint 校验提交信息，git-cliff 按提交记录生成中文 Release 说明。版本号和发布时机由维护者决定，推送稳定版本 tag 后由 GitHub Actions 构建和发布。

## 初始化开发环境

使用 Node.js 22.12+ 和 npm；CI 固定为 Node.js 22.22.0。首次进入仓库执行 `npm ci`。

安装依赖时，`prepare` 会运行 `scripts/install-hooks.mjs`，启用两个 Git hooks：

| Hook | 执行时机 | 检查内容 |
| --- | --- | --- |
| `commit-msg` | 创建提交时 | 使用 commitlint 检查本次提交信息 |
| `pre-push` | 推送分支或 tag 时 | 检查根包版本、锁文件版本和发布 tag 是否一致 |

已有工作区、或 npm 配置了 `ignore-scripts` 时，安装依赖后手动执行：

```sh
npm run hooks:install
```

`commit-msg` 需要本项目的开发依赖；`pre-push` 的版本检查只需要 Node.js 和 Git。

安装器会保留已有的自定义 `core.hooksPath` 或默认目录中的其他 hooks。遇到保留提示时，将下面两条命令分别接入已有 hook，并保留原来的检查：

```sh
# commit-msg：保留 Git 传入的消息文件路径参数
npm run --silent commitlint -- --edit "$1"

# pre-push：保留 Git 通过标准输入传入的引用列表
node scripts/pre-push.mjs "$@"
```

## 提交信息规范

格式为：

```text
<type>(<可选 scope>): <变更描述>

<可选正文>

<可选 footer>
```

`type` 使用小写，描述不能为空，首行不超过 100 个字符，首行结尾不用英文句号。正文和 footer 与前一部分之间留空行。支持中文描述，也允许描述中的 GitHub、SSH 等名称保留大小写。

| 类型 | 用途 | Release 中的展示 |
| --- | --- | --- |
| `feat` | 新功能 | 🚀 新功能 |
| `fix` | Bug 修复 | 🐛 Bug 修复 |
| `perf` | 性能优化 | ⚡ 性能优化 |
| `refactor` | 重构 | 🔧 重构改进 |
| `revert` | 回退已有变更 | ↩️ 回退变更 |
| `docs` | 文档修改 | 默认隐藏 |
| `test` | 测试修改 | 默认隐藏 |
| `ci` | CI 工作流修改 | 默认隐藏 |
| `build` | 构建工具或依赖修改 | 默认隐藏 |
| `chore` | 维护事务、版本号更新 | 默认隐藏 |
| `style` | 不改变行为的代码格式调整 | 默认隐藏 |

`scope` 可使用 `workspace`、`terminal`、`ssh`、`repository`、`desktop`、`release` 等模块名，不强制固定范围。界面功能或交互修复应使用 `feat` / `fix`；`style` 用于代码格式调整。

推荐示例：

```text
feat(workspace): 支持记住工作区侧边栏设置
fix(terminal): 修复断线后无法重新连接的问题
perf(repository): 加快远程仓库列表加载速度
refactor(ssh): 简化连接状态管理
chore(release): 发布 0.2.0
```

git-cliff 直接使用提交中的描述。请写明发生了什么变化，例如“修复断线后无法重新连接的问题”，避免只有“修改代码”“修复问题”等笼统描述。分类标题是中文，提交描述会保留原文。

不兼容变更使用 `!` 或 `BREAKING CHANGE:` 标记，建议同时说明迁移方式：

```text
refactor(config)!: 调整连接配置格式

统一保存连接设置和身份验证选项。

BREAKING CHANGE: 旧连接配置需要重新导入，请先导出已有配置。
```

不兼容变更优先进入“⚠️ 不兼容变更”，即使类型是通常隐藏的 `build` 或 `chore` 也会保留。

手动检查最近一条提交：

```sh
npm run commitlint -- --last --verbose
```

历史提交不要求重写。commitlint 保留工具默认的自动合并、自动回退、fixup/squash 等消息例外；新功能和修复仍使用上述格式。Release 生成器会将历史上的普通非规范提交保留在“其他变更”，并隐藏自动合并记录。

## 分支、PR 与 CI

通过分支和 PR 开发时，PR 标题也遵守提交格式。一次功能开发有多个过程提交时，推荐 Squash merge，并确认最终合并提交仍使用规范描述。

`.github/workflows/commitlint.yml` 会检查：

- 分支推送：本次推送新增的提交；新分支从与默认分支的共同祖先开始检查。
- PR：PR 标题，以及 base 到 head 之间的提交；修改标题也会重新检查。
- 初次创建默认分支：该次推送的全部提交。

本地 hook 检查当前提交；CI 还会检查本次变更范围，因此绕过本地 hook 的不规范提交仍会导致 CI 失败。普通推送和 PR 不会重新检查变更范围之前的旧历史。

要让 CI 失败阻止 PR 合并，可在 GitHub 分支保护或 ruleset 中，将 **Commit messages 工作流下的 commitlint 检查**设为必需状态检查。

## 预览 Release 说明

`cliff.toml` 保存分类、过滤规则和 Markdown 模板，git-cliff 已锁定在开发依赖中，无需单独全局安装。

在准备发布前，可以指定上一已发布版本和当前提交预览。下面以 `v0.1.2` 为上一版本、计划发布 `v0.2.0` 为例：

```sh
npm run release:notes -- v0.1.2..HEAD --tag v0.2.0 --tag-pattern '^v0\.2\.0$' --output release-notes.preview.md
```

这里的 `--tag` 只给预览命名，不会创建 Git tag。说明只包含已经提交的代码变更，预览文件已加入 `.gitignore`。请按实际版本替换示例中的版本号；限定 tag 匹配可以防止中途构建失败留下的 tag 将说明分段。

已有本地 tag 时，可以使用与 CI 相同的生成入口。该命令需要已配置认证的 GitHub CLI，只读取 GitHub 的 Release 列表并写入本地文件：

```sh
GH_REPO=ShaoClean/remote-git npm run release:notes:github -- v0.1.2 release-notes.preview.md
```

该入口会分页读取成功发布的稳定 Release，从当前 tag 的 first-parent 历史中选择最近的、更低版本的已发布 tag。草稿、预发布、当前 tag、其他发布分支上的 tag，以及只有 tag 但没有已公开 Release 的版本都不作为起点。没有符合条件的上一版本时，从当前 tag 可达的历史起点生成说明。

生成范围固定在当前 tag 上，之后新增的提交不会混入。中间未发布 tag 的变更会合并到本次说明。只有构建、测试或维护提交时，会给出维护说明并附完整变更链接。

## 发布新版本

根 `package.json` 是唯一版本来源。标签必须是 `vX.Y.Z`，并与根 `package.json`、`package-lock.json` 的两处根版本一致。

下面以补丁版本为例；新增功能需要提升次版本时，将 `patch` 改为 `minor`：

```sh
npm version patch --no-git-tag-version --workspaces=false
RELEASE_TAG="v$(node -p 'require("./package.json").version')"
node apps/desktop/scripts/release.mjs tag "$RELEASE_TAG"
git add package.json package-lock.json
git commit -m "chore(release): 发布 $RELEASE_TAG"
git tag "$RELEASE_TAG"
git push origin HEAD
git push origin "$RELEASE_TAG"
```

标签指向实际待发布提交。修改工作区文件不会改变已经创建的 tag 指向，版本检查读取的是推送对象中的文件。

推送 tag 后，`.github/workflows/release.yml` 按以下顺序执行：

1. 校验版本、公开更新源、hooks 和 Release 说明生成逻辑，运行桌面单元测试。
2. 在 macOS arm64/x64、Windows x64、Linux x64 的原生 runner 上测试并构建安装包。
3. 汇总附件，校验更新元数据、文件大小和 SHA-512，生成 `SHA256SUMS`。
4. 获取完整 Git 历史，用 git-cliff 生成当前版本的 `release-notes.md`，附上版本对比链接。
5. 创建 Release 草稿并写入说明；重跑已有草稿时也更新说明。
6. 上传全部附件，成功后公开 Release 并标记为最新版本。

构建或说明生成失败时不会发布新 Release；附件上传失败保留草稿供重跑。已公开的 Release 不会被工作流覆盖。发布仅使用 Actions 的 `GITHUB_TOKEN`，无需新增个人令牌。生成的 Markdown 写入 Release 正文，不会自动提交 `CHANGELOG.md` 或修改版本号。

## 验证修改

```sh
npm run test:hooks
npm run test:release-notes
npm run desktop:test:unit
```

hooks 测试在临时仓库中验证提交拦截、推送版本检查和 CI 提交范围；说明测试验证分类、旧格式记录、不兼容变更、首次发布、失败 tag 和维护版本。这些测试不会发布 GitHub Release。

桌面构建、各平台安装包及实际升级验收要求见 [README.md](README.md)。
