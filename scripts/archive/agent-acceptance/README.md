# Agent 迁移验收归档

归档原 `scripts/agent` 中的 P0 冻结对照、逐批断言计划、证据合并/审查、UI 追踪及专项 Mac 验收工具，以及桌面目录中的六个专项 Mac 演练文件。日常构建和 CI 入口仍在 [`scripts/agent`](../../agent/README.md)。

`manifest.json` 记录每个文件的旧路径、新路径和整理前 SHA-256；原始版本可从 `a07cb2f61fb6d18cebb66ab12e84b846cd028077` 检出。目录整理后的历史工具共用 `replay-support.mjs`：47 份重复的上下文/哈希/JSON/输入枚举、54 份命令与日志记录、29 份运行工具指纹逻辑已集中维护。各批次的断言、ID、冻结版本、拒绝陈旧来源、回执门槛及失败判断仍由原计划和验证器执行。

## 入口

在仓库根目录执行：

```sh
# 列出可运行的工具及旧路径
npm run acceptance:archive -- list

# 原有验收工具单元测试，以及公共回放工具回归
npm run test:acceptance

# 执行某个已归档命令，参数格式保持不变；名称可带或不带扩展名
npm run acceptance:archive -- p0-commit-files-service NEW_REPLAY_DIRECTORY
npm run acceptance:archive -- check-release-evidence LEDGER RECEIPTS REPORT POLICY
```

也可直接使用新路径，例如 `node scripts/archive/agent-acceptance/p0-commit-files-service.mjs ...`。需要 Node 的 TypeScript strip-types 或自定义 loader 的原命令，仍须传入对应 Node 参数；直接启动方式保留这些用法。主入口对执行命令使用当前 Node 参数并转发子进程退出状态。

本地 Mac 策略文件为 [`acceptance-mac-arm64.json`](acceptance-mac-arm64.json)。旧命令中明确传入的策略、loader 或测试脚本路径也要按 `manifest.json` 更新。新的回放会将公共模块一并纳入输入哈希与源码快照，命令失败日志和非零退出仍完整保留。

## 历史证据

整理不改写 `docs/acceptance` 中已生成的回执、快照、补丁或原始日志。它们记录的旧路径和输入哈希仍是当时的事实，不会重新标记为新路径/新源码。部分批次依赖未入库的完整本地历史归档；缺少归档时依然会拒绝回放，不能据此声称通过。

需要**精确重现整理前的历史脚本与哈希**时，在隔离工作树检出对应历史 SHA，并使用原路径；当前归档中的工具用于显式重放，不替代历史脚本的逐字副本。保持旧版本绑定的生成器在当前 HEAD 下仍会拒绝运行，需要先重新审核其输入。
