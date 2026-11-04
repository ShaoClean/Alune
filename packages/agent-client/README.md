# @alune/agent-client

类型化 Agent 通信与连接状态，不保存仓库业务真相，也不自动重连或重放请求。

- 默认入口与 `/browser` 只导出 `AgentClient` 和 `MessageTransport`，没有 Node/SSH/数据库依赖。
- `/node` 额外提供 `StdioTransport` 和 `spawnAgent`；Agent 间通信也可复用客户端。

```ts
import { spawnAgent } from '@alune/agent-client/node';

const agent = spawnAgent(nodeExecutable, [agentEntry, 'serve', '--data-dir', dataDirectory]);
try {
  const identity = await agent.client.initialize({ name: 'example', version: '1' });
  const health = await agent.client.health();
  // Use identity.capabilities before invoking optional methods.
} finally {
  await agent.close();
}
```

浏览器传入自己的受限通信桥实现 MessageTransport，再使用同一 `AgentClient`。`initialize` 协商版本/身份/能力；`request` 返回 Promise，`startRequest` 还返回 requestId，便于超时后在同一会话查询 `tasks.get`。跨会话任务不存在持久保证，不能凭“未找到”重放写操作。

AbortSignal 只发出取消请求，Promise 等待实际响应或超时。取消与成功响应竞态时保留实际结果；超时和断线可能是 outcome=unknown。SDK 不自动重试，包括所谓只读方法（它们也可能涉及对象补取或外部请求）。发送前已取消或本地队列拒绝为 not-started。

`onEvent` 可以返回 Promise，SDK 在所有消费者完成后发送 ACK。业务必须处理 `events.resync-required` 并重新查询相应快照。重复事件不重复交付；未知会话、无法解释的序号缺口、非法响应或客户端事件队列超限关闭连接。消费者抛错也关闭连接，避免假装已消费。

stdio 传输严格验证 UTF-8/帧大小，支持半帧和多帧，出站队列有字节/条目上限。`spawnAgent.close()` 先结束 stdin 等待退出，期限后只终止它自己启动的子进程；不操作其他应用。

检查：`npm test -w @alune/agent-client`、`node scripts/agent/check-browser.mjs`、`node scripts/agent/check-boundaries.mjs`。

协议 1.1 的 `storageStatus()` 与 `backupDatabase()` 具有同源结果校验，并检查 Agent 归属。备份收据当前明确限定为新 Agent 数据库，不包含完整凭据迁移。连接 1.0 Agent 时，这两个方法在发送前按能力集拒绝，核心方法仍可用。
