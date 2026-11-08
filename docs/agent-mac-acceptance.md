# Mac 本地验收与旧架构退役

2026-11-08 用户确认本轮仅要求当前 Mac（macOS arm64）验收通过。
Windows x64、Linux x64、macOS x64 的验证延期，不标为通过；保留平台实现和构建配置。
GitHub Actions 不再是本轮前置条件。本决定替代 Wiki 中原先“四平台齐全才切换”的本轮要求。

## 放行范围

`scripts/agent/acceptance-mac-arm64.json` 明确本轮策略。执行：

```sh
node scripts/agent/check-release-evidence.mjs P0_LEDGER RECEIPTS REPORT scripts/agent/acceptance-mac-arm64.json
```

回执顶层必须声明 `policy: "mac-arm64-local-2026-11-08"`。原有未指定策略的调用仍要求四平台。
本地证据使用 `{ "path": "relative/run.log", "sha256": "文件的 SHA256" }`，文件须在回执目录内；
门槛核对真实文件字节，拒绝缺失、篡改及指向目录外的链接。
日志只记录测试夹具和断言，不归档用户凭据。保留实际源码 SHA，不把旧执行改标为新执行。

## 执行顺序

1. 完成范围调整及门槛验证。
2. 对账完整 P0 功能台账；核对已有执行断言，补齐尚未验证的能力和错误分支。
3. 在隔离的应用与数据目录执行当前 Mac 安装包的新装、旧版升级、原生更新和回退；不使用日常应用数据。
4. 完成删旧前协议、本地/SSH、终端、任务去重、恢复与性能验收。旧性能结果只在运行输入一致时复用。
5. 上述门槛通过后，停止旧写者、保留已验证备份、切换桌面/Web 默认入口，然后退役旧实现与依赖。
6. 从干净源码重建，执行删旧后的第二轮完整 Mac 回归并独立归档，再更新交付状态。

全量 P0、数据保护及两轮回归要求保持；未接线的历史条目单独审查，不以删台账消除缺口。
当前仍处于删旧前验收；本范围变更本身不代表验收通过或已经切换。

2026-11-08 的[删旧前最终检查](agent-retirement-final-check.md)记录本轮工程验证与性能复用依据；同日[分支焦点修复与完整原生回归](branch-picker-focus-regression.md)已完成非 focused 的 write/restore。完整 P0 逐项断言审查、真实 Mac 安装更新回退及实际备份演练仍未放行，未删除旧入口。
