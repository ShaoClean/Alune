# 分支切换焦点修复与完整原生回归

日期：2026-11-08。基准 HEAD：`8d3441768ac1acfb4f08a03c0c27e3345c9d8bf2`；本轮为未提交工作树，实际输入以每轮 `source-state.json`、补丁、源码副本和构建产物哈希为准，不冒充新的干净提交。

## 已确认原因及修复

`full-focus-repro-v1` 使用真实鼠标选择分支，复现了原有 `full-v3` 的失败。轨迹记录：点击筛选结果后，`Git 操作进行中` 的原生模态提示取得“关闭提示”按钮焦点；分支选择器关闭时工具栏仍处于 native modal 的 inert 范围。旧代码在调用 `focus()` 前就清除了待恢复标记；该次调用无效，提示关闭后焦点留在 body。

修复没有取消 Git 进度提示、放松焦点断言或从测试中代替用户手动聚焦工具栏：

- [BranchPicker](../apps/web/src/components/BranchPicker.tsx) 只在弹层关闭且触发器可用时启动恢复。
- [焦点恢复函数](../apps/web/src/components/branch-picker-focus.ts) 等待真实 `activeElement` 命中按钮才完成；被原生模态层、inert 或 disabled 阻止时保留请求，随 DOM 的 open/inert/disabled/挂载变化在下一帧重试。不使用固定延迟或持续轮询。
- 成功、组件清理时断开 observer 并取消帧，不在后续用户操作时重新抢焦点。
- [专项测试](../apps/web/tests/branch-picker-focus.test.mjs) 覆盖模态阻止后恢复、disabled 后恢复、成功后不抢焦点，以及卸载清理。
- 原生驱动保留有界的焦点/模态时间线，失败时不再倾倒整份 body；成功场景同样归档真实轨迹。

## 本轮验证

| 验证 | 结果 | 原始证据 |
|---|---|---|
| 专项焦点、键盘导航、分支切换、Git 提示单测 | 11/11 | [日志](../.claude/acceptance-20261108/branch-focus-targeted-unit-node22-v1.log) |
| Web 全部单元测试，项目 Node 22 | 346/346，0 跳过 | [日志](../.claude/acceptance-20261108/branch-focus-web-unit-node22-v1.log) |
| 桌面全部单元测试，项目 Node 22 | 58/58，0 跳过 | [最终日志](../.claude/acceptance-20261108/branch-focus-desktop-unit-node22-v2.log) |
| 原生分支 focused 回归 | 4 场景通过，包含真实 Git 切换、工作区/index 字节保护及焦点返回 | [工作区回执](../.claude/acceptance-20261108/branches-focus-fix-v1/workbench.json)、[来源](../.claude/acceptance-20261108/branches-focus-fix-v1/source-state.json) |
| 修复后完整原生首轮 `full-focus-fix-v1` | 原焦点阻塞已越过：进度模态开启/关闭路径通过；16 条前序场景后，停在本地仓库检查的原生 Enter，未进入 restore | [回执](../.claude/acceptance-20261108/full-focus-fix-v1/workbench.json)、[失败日志](../.claude/acceptance-20261108/full-focus-fix-v1/native.log) |
| 完整原生重跑 `full-focus-fix-v2` | **write / restore 均通过，focus=null，退出码 0**；184 条工作区场景、write 13 条/restore 6 条分阶段断言，共 203 条场景回执。实际生产 Web 与桌面加载资源逐文件匹配，原 Agent 包 1,821 文件完整性仍通过。 | [完整汇总](../.claude/acceptance-20261108/full-focus-fix-v2/regression-summary.json)、[write 完成标记](../.claude/acceptance-20261108/full-focus-fix-v2/complete-write.json)、[restore 完成标记](../.claude/acceptance-20261108/full-focus-fix-v2/complete-restore.json)、[哈希索引](../.claude/acceptance-20261108/full-focus-fix-v2/regression-index.json) |

`full-focus-fix-v1` 的下一处失败停在本地仓库检查的原生 Enter，旧驱动未记录按键是否送达；本轮改为使用已有的窗口激活、两帧等待和真实 keydown/keyUp 助手，并将 Electron `Return` 映射到 DOM `Enter` 做送达核对。仍要求 Enter 检查仓库、不得提前注册，之后才显式打开；未改成直接调用检查接口或点击按钮来绕过键盘断言。重跑已通过，生产 `OpenLocalRepository` 未修改。

早期本机 Node 26 的 Web 全测有 13 个文件因 `packages/ui/tests/resolve-ts.mjs` 的图标 CJS 解析钩子递归而失败（231 通过、13 失败）；原日志保留在 [Node 26 尝试](../.claude/acceptance-20261108/branch-focus-web-unit-v1.log)。本轮未修改该加载器，改用原生验收及 Agent 固定运行时对应的 Node 22，完整 346/346 通过；不声称 Node 26 兼容性已修好。

## 构建、性能及放行边界

真实生产 Web 资源已重建，验收构建启用 `ALUNE_UI_AUDIT=1`；桌面资源采用增量复制，保留旧生成资源，当前 index.html 指向新哈希资源。每轮来源记录包含当前 Web、桌面驱动、未提交补丁、新文件副本及产物指纹；这不是干净 checkout 构建放行。

Agent 包、协议/SDK/领域运行代码、计时驱动及依赖没有变化。本轮只改变前端焦点恢复和验收驱动；既有性能测量不含 Chromium 渲染，不能据此推导前端渲染性能。沿用[最终检查](agent-retirement-final-check.md)记录的原 SHA 两轮 80/80，不增加无意义的新性能采样。

完整原生矩阵通过也不能直接放行删旧：[仅含本轮 UI 的本地回执](../.claude/acceptance-20261108/full-focus-fix-v2-receipts/receipts.json)保留 203 条场景，自动关联 646 个原始 ID，这不是 646 项完整功能通过。[Mac 策略门槛报告](../.claude/acceptance-20261108/full-focus-fix-v2-receipts/gate-missing.json)仍退出 1，2,758 个 P0 ID 中 2,112 个未被该 UI-only 输入关联；其中显示工程 gate 缺失，是因为没有把上一轮协议/SSH/恢复/性能回执混入这份 UI-only 输入，不代表这些工程测试退化为失败。

[新增轨迹对账](../.claude/acceptance-20261108/ui-reconciliation-focus-fix.json)保留原始 888 个 UI ID、历史 628 个关联及原 17 个已审部分断言；新增 2 个原缺口有完整执行轨迹但待逐 ID 审查，不能自动补记通过。其余仍为 129 映射待审、90 需补测、4 已有断言待重跑、18 未接线契约待审，`releaseEligible=false`。P0 全台账仍须逐 ID 审查断言，当前 Mac 的真实安装/升级/原生更新/回退和实际完整备份恢复演练仍需独立证据。没有停止日常写者、切换默认入口、删除旧实现或修改日常数据；本轮未提交、未推送、未发布 Wiki。
