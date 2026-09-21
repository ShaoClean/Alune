# 参与 Alune

## 提交 Issue

请先[搜索已有 Issues](https://github.com/ShaoClean/Alune/issues)，再通过[模板选择页](https://github.com/ShaoClean/Alune/issues/new/choose)提交：

| 模板     | 用途                                     | 自动标签       |
| -------- | ---------------------------------------- | -------------- |
| 功能建议 | 新能力或尚需探索的使用场景               | `enhancement`  |
| Bug 报告 | 功能异常、崩溃或与预期不一致的行为       | `bug`          |
| 优化建议 | 现有功能的性能、布局、易用性或可靠性改善 | `optimization` |

功能与优化事项统一记录背景、目标、范围、方案线索、验收标准、验证方案、风险与待确认事项。尚未确定的设计请明确标注；不要把建议方案写成已经实现的功能。探索性需求可由维护者补充 `question` 标签。

## 跟踪进度

[公开 TODO 看板](https://github.com/users/ShaoClean/projects/1)关联本仓库的 Issues。`Todo` 表示尚未开始，`In Progress` 表示正在处理，`Done` 表示已经完成。验收清单完成并核实后再关闭 Issue；未定方案继续记录在 Issue 中，不视为已经承诺的实现。

## 提交 Pull Request

1. 从默认分支 `development` 创建工作分支，保持每个 PR 聚焦一个问题。
2. 填写自动加载的 PR 模板，说明行为变化、主要改动、兼容影响和实际验证结果。
3. 完整解决 Issue 时填写 `Closes #编号`；只完成部分工作时使用 `Refs #编号`。
4. UI 改动在 Wiki 验收记录中附前后截图，PR 中引用对应页面或图片；涉及持久化、SSH 或桌面更新时，记录相关回归验证。未验证的平台或场景需要明确列出。
5. 填写“设计文档（Wiki）”，并在 Wiki 页面补充 Issue / PR 反向链接；不需要独立设计文档的小改动注明原因。

PR 标题和提交信息须遵守 Conventional Commits，使用 `feat: ...`、`fix: ...`、`perf: ...`、`refactor: ...`、`docs: ...` 或 `chore: ...` 等格式；本地 hook 和 CI 会执行校验。完整提交规范、Git hooks 和 Release 说明生成流程见 [CONTRIBUTE.md](../CONTRIBUTE.md)，开发和测试命令见[开发与打包](../docs/development.md)。

## 维护设计文档

[GitHub Wiki](https://github.com/ShaoClean/Alune/wiki) 是功能、优化及缺陷修复设计的统一入口。使用 [设计模板](https://github.com/ShaoClean/Alune/wiki/Design-Template) 新建 `Issue-<编号>` 页面；较长验收记录可拆为 `Issue-<编号>-Validation`。内容包括背景、目标、方案、验收标准、关联 PR 和实际验证结果。

新增或更新页面时，同步维护 [功能设计索引](https://github.com/ShaoClean/Alune/wiki/Feature-Designs) 或 [缺陷修复索引](https://github.com/ShaoClean/Alune/wiki/Bugfix-Designs)，在 Issue / PR 正文填写完整 Wiki 链接。图片和附件存放在 Wiki 仓库的 `assets/issue-<编号>/`，检查页面、图片和附件可访问。PR 审阅时附 Wiki 修订链接或 commit SHA，完整操作见 [Wiki 维护约定](https://github.com/ShaoClean/Alune/wiki/Contributing)。

没有 Wiki 写权限时，可先在 Issue / PR 中提供草案与附件，由维护者整理后补充链接。运行、开发、发布及现行配置说明、测试必需的 fixtures 留在代码仓库；设计文档、验收记录及截图不再在主仓库保留完整副本。已迁移资料的旧路径对应关系见 [迁移清单](https://github.com/ShaoClean/Alune/wiki/Migration-25)。

公开日志与截图请先脱敏，避免提交真实数据库、私人服务器地址、SSH 密码、私钥和访问令牌。
