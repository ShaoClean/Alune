# Agent 日常工具

本目录只保留当前构建、打包、发布及普通回归需要的工具。历史迁移验收工具已移除，需要复查时使用对应的 Git 历史提交。

| 用途                              | 入口                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------- |
| 普通 Agent / Web 回归             | `npm test -w @alune/agent` / `npm test -w web`                                     |
| 本目录工具回归                    | `npm run test:agent-tools`                                                         |
| 独立运行包                        | `node scripts/agent/package.mjs --output NEW_DIRECTORY`                            |
| 随包 Node、SQLite、PTY 与生命周期 | `node scripts/agent/test-packaged.mjs PACKAGE_DIRECTORY`                           |
| 协议版本协商                      | `node scripts/agent/test-negotiated-package.mjs PACKAGE_DIRECTORY`                 |
| 打包 SDK、加密 SSH 与断线回归     | `node scripts/agent/test-ssh-isolated.mjs PACKAGE_DIRECTORY`                       |
| 浏览器与架构边界                  | `node scripts/agent/check-browser.mjs` / `check-boundaries.mjs`                    |
| 干净稀疏检出                      | `check-clean-checkout.mjs`，参数由 CI 工作流提供                                   |
| SSH 分发与发布目录                | `ssh-bundle.mjs` / `release-assets.mjs`                                            |
| Node 发行版与指纹                 | `runtime-pins.json`、`runtime-input.mjs`、`download-runtime.mjs`、`pin-runtime.py` |

`test-bootstrap.mjs`、`test-web-gateway-linux.sh` 和 `retirement.test.mjs` 继续由原 CI / npm 命令调用。当前开发目录可能保留旧工作区的忽略生成文件；退役与干净检出检查应在新检出中运行，不能把残留目录当作源码退役回归。

日常检查执行 `npm run test:agent-tools`；普通业务回归使用各工作区的 `npm test`。
