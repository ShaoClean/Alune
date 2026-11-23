# @alune/domain

跨端共享的纯模型与算法，无 I/O、配置存储、任务调度、网络或平台探测。

- `ResourceRef`：以 `agentId + resourceId` 标识资源，绝对路径不能作为跨主机身份。
- `parseLfsPointer` / `LfsPointer`：LFS 指针解析；调用方统一从 `@alune/domain` 导入。

运行 `npm test -w @alune/domain`。TypeScript 构建不注入 Node 或 DOM 类型，避免纯模型隐式依赖运行环境。
