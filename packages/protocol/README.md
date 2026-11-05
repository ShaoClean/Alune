# @alune/protocol

Agent 消息契约和运行时校验；不依赖 Node、Electron、SSH、数据库或服务商 SDK。
当前协议 major 为 1，minor 为 1。消息采用 JSON-RPC 2.0 形状，传输层按 UTF-8 换行分帧。初始化协商双方较低的 minor，只暴露该版本支持的方法。1.0 客户端仍可调用核心方法；1.1 的存储方法不会被误暴露，新增领域错误在旧会话降为旧客户端可解析的错误信封。

请求 ID 使用 `固定前缀:递增正整数`（整数必须安全且无前导零）。一个会话内前缀不变，序号可跳过但不能倒退或重用；响应仍回显请求 ID。SDK 自动生成。Agent 只保存已接收序号上界，既能拒绝历史重复写，又不因长时间使用而积累无限 tombstone 或强制重连。

```ts
import { encodeMessage, parseMessage, validateInitialize } from '@alune/protocol';

const frame = encodeMessage({
  jsonrpc: '2.0',
  id: 'request:1',
  method: 'initialize',
  params: { protocol: { major: 1, minor: 1 }, client: { name: 'example', version: '1' } },
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

协议 1.2 增加按能力协商的 `repositories.*` 读取入口。仓库查询携带
`{ resource: { agentId, resourceId }, kind, params }`；跨 Agent 标识、未知查询和额外字段被拒绝。
`repositories.read` 的小结果直接返回，大结果以不可变快照和 32 KiB 块传输；SDK 负责校验身份、重组及释放。
1.0/1.1 会话不声明或接受这些入口。Git 写操作仍留在旧执行路径，P3 不提供任意 Git 命令接口。
