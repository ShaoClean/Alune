# @alune/protocol

Agent 消息契约和运行时校验；不依赖 Node、Electron、SSH、数据库或服务商 SDK。
当前协议 major 为 1，minor 为 0。消息采用 JSON-RPC 2.0 形状，传输层按 UTF-8 换行分帧。

```ts
import { encodeMessage, parseMessage, validateInitialize } from '@alune/protocol';

const frame = encodeMessage({
  jsonrpc: '2.0',
  id: 'request:1',
  method: 'initialize',
  params: { protocol: { major: 1, minor: 0 }, client: { name: 'example', version: '1' } },
});
const message = parseMessage(frame);
if ('method' in message && message.method === 'initialize') {
  validateInitialize(message.params);
}
```

`parseMessage` 校验单条完整消息，拒绝批量/歧义信封、无效 ID、非有限数字、过深结构及超过 8 MiB 的 UTF-8 帧。
它不负责读取流、拼接半帧、请求调度或认证。`encodeMessage` 输出末尾带一个换行的帧，JSON 字符串内部的换行会转义。

`FrameDecoder` 单独负责有界字节分帧，支持分块 UTF-8 和同块多帧，拒绝错误编码、超限半帧及 EOF 截断。核心 health/version/capabilities/subscription/task 结果也在本包定义类型与运行时校验；Agent 和 Client 不各自复制一套契约。

`validateInitialize` 检查版本与客户端身份；不同 major 拒绝，同 major 的能力范围必须由初始化响应的 capabilities 决定。
`validateInitialized` 校验服务端初始化响应。`parseEvent` 校验会话序号和主机/资源身份；订阅者仍需检查当前会话与连续序号。

`ProtocolError` 将稳定错误种类转为结构化错误，outcome 区分未开始、已完成与未知。未知执行结果不构成自动重试授权。
队列/流块常量只定义协议上限，具体排队、ack、背压与重同步由 Agent 和 Client 实现，不能仅凭常量存在宣称已经处理背压。

`legacy-events` 保留旧 Socket.IO 类型，供 shared 兼容导出；新消息使用 `AgentEvent`。
运行 `npm test -w @alune/protocol` 验证协议边界。
