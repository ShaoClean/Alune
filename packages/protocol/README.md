# @alune/protocol

Agent 消息契约和运行时校验；不依赖 Node、Electron、SSH、数据库或服务商 SDK。
当前协议为 **1.7**。消息采用 JSON-RPC 2.0 结构，stdio 按 UTF-8 换行分帧。不同 major 的握手直接拒绝；相同 major 协商双方支持的较低 minor。客户端以初始化响应中本次会话的 `capabilities` 为准：较低 minor 不公布、也不能直接调用较高 minor 的方法。普通桌面/Web 的默认入口与协议版本是两个独立选择。

| 协商版本 | 本机独立 Agent 新增能力（在前一行基础上） |
| --- | --- |
| 1.0 | 健康、版本、能力查询，订阅、事件确认、取消请求和任务查询，共 7 个核心方法。 |
| 1.1 | 状态和数据库备份、代理设置和更新桥、账户与凭据管理、诊断日志及 AI 配置。 |
| 1.2 | 仓库发现、登记和读取，含状态、分析、快照分块与释放。 |
| 1.3 | 仓库写操作预检、执行、取消及操作状态。 |
| 1.4 | PTY 创建、列举、写入、调整大小、确认输出及关闭。 |
| 1.5 | AI 请求、PR/MR 读取与协作，以及跨仓库审查和工作区分组。 |
| 1.6 | SSH 主机目录、绑定和转发通道，跨主机工作区移除及代理连通性测试。 |
| 1.7 | 显式目录授权、列出/读取/写入文本及撤销。授权绑定 Agent 与当前会话。 |

[逐方法清单](../../scripts/agent/protocol-1-capabilities.json)对应普通 `serve` 的本机 stdio 会话。SSH 叶节点和桌面只读日志窗口另有限权，不得用版本号推断它们拥有同样权限。用 `node scripts/agent/test-negotiated-package.mjs PACKAGE_DIRECTORY` 可对安装包逐版本握手，并验证调用被隐藏的方法会在校验参数和执行前返回 `unknown-method`。


请求 ID 使用 `固定前缀:递增正整数`（整数必须安全且无前导零）。一个会话内前缀不变，序号可跳过但不能倒退或重用；响应仍回显请求 ID。SDK 自动生成。Agent 只保存已接收序号上界，既能拒绝历史重复写，又不因长时间使用而积累无限 tombstone 或强制重连。

```ts
import { encodeMessage, parseMessage, PROTOCOL_VERSION, validateInitialize } from '@alune/protocol';

const frame = encodeMessage({
  jsonrpc: '2.0',
  id: 'request:1',
  method: 'initialize',
  params: { protocol: PROTOCOL_VERSION, client: { name: 'example', version: '1' } },
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
1.0/1.1 会话不声明或接受这些入口。1.2 不提供 Git 写接口；从 1.3 起按协商能力开放明确列出的仓库写操作，不提供任意 Git 命令接口。
