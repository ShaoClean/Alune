# 参与 RemoteGit

## 提交 Issue

请先[搜索已有 Issues](https://github.com/ShaoClean/remote-git/issues)，再通过[模板选择页](https://github.com/ShaoClean/remote-git/issues/new/choose)提交：

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
4. UI 改动附前后截图；涉及持久化、SSH 或桌面更新时，记录相关回归验证。未验证的平台或场景需要明确列出。

建议使用 `feat: ...`、`fix: ...`、`perf: ...`、`refactor: ...`、`docs: ...` 或 `chore: ...` 形式的简洁 PR 标题。开发和测试命令见[项目 README](../README.md)。

公开日志与截图请先脱敏，避免提交真实数据库、私人服务器地址、SSH 密码、私钥和访问令牌。
