import { AgentClient, frameTransport, type FrameChannel } from '@alune/agent-client';
import { MAX_FRAME_BYTES, TERMINAL_TOPICS } from '@alune/protocol';

declare global {
  interface Window {
    aluneAgent?: FrameChannel & { open(): Promise<void> };
  }
}
export const workspaceTopics = [
  'repositories.changed',
  'accounts.hosts.changed',
  'accounts.tokens.changed',
  'hosts.changed',
  ...TERMINAL_TOPICS,
];
export let uiAgent: AgentClient | undefined;
const changed = new Set<() => void>();
export const observeUiAgent = (fn: () => void) => {
  changed.add(fn);
  return () => {
    changed.delete(fn);
  };
};
export const currentUiAgent = () => uiAgent;

async function webChannel(): Promise<FrameChannel> {
  const invite = new URLSearchParams(location.hash.slice(1)).get('alune-session');
  if (invite) {
    history.replaceState(history.state, '', location.pathname + location.search);
    sessionStorage.setItem('alune.dev.session', invite);
  }
  const url = new URL(
    '/__alune_agent/' + (location.pathname === '/logs' ? 'logs' : 'workspace'),
    location.href,
  );
  url.protocol = 'ws:';
  const token = sessionStorage.getItem('alune.dev.session');
  if (!token || !/^[a-f0-9]{64}$/.test(token))
    throw new Error('请使用终端显示的完整工作区链接打开。');
  const socket = new WebSocket(url, 'alune.' + token);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => socket.close(), 10000);
    socket.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
    socket.onclose = socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error('本地服务连接失败，请使用终端中本次启动的完整工作区链接。'));
    };
  });
  return {
    async send(frame) {
      if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > 2 * MAX_FRAME_BYTES)
        throw new Error('本地连接已断开或过载。');
      socket.send(frame);
    },
    close: () => socket.close(),
    onEnd(fn) {
      socket.addEventListener('close', fn);
      return () => socket.removeEventListener('close', fn);
    },
    onFrame(fn) {
      const receive = (event: MessageEvent) => fn(event.data);
      socket.addEventListener('message', receive);
      return () => socket.removeEventListener('message', receive);
    },
  };
}
async function openClient(expected?: string) {
  const desktop = window.aluneAgent;
  if (desktop) await desktop.open();
  const client = new AgentClient(frameTransport(desktop ?? (await webChannel())));
  try {
    await client.initialize({ name: 'alune-ui', version: __APP_VERSION__ });
    if (expected && client.initialized!.agentId !== expected)
      throw new Error('工作区身份已变化，请重新打开。');
    await client.subscribe(
      location.pathname === '/logs' ? ['diagnostics.logs.changed'] : workspaceTopics,
    );
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}

export async function connectUiAgent(install: (client: AgentClient) => Promise<void>) {
  const initial = await openClient();
  const owner = initial.initialized!.agentId;
  let unloading = false,
    connecting = false;
  const close = () => {
    unloading = true;
    uiAgent?.close();
  };
  window.addEventListener('pagehide', close, { once: true });
  if (import.meta.hot) import.meta.hot.dispose(close);
  async function attach(client: AgentClient) {
    if (unloading) {
      client.close();
      return;
    }
    uiAgent = client;
    await install(client);
    for (const fn of changed) fn();
    client.onClose(() => {
      if (!unloading) void reconnect();
    });
  }
  async function reconnect() {
    if (connecting || unloading || uiAgent?.state === 'ready') return;
    connecting = true;
    try {
      for (const ms of [200, 500, 1000, 2000, 5000]) {
        await new Promise((resolve) => setTimeout(resolve, ms));
        if (unloading) return;
        try {
          const client = await openClient(owner);
          if (client) {
            await attach(client);
            return;
          }
        } catch {
          /* Retain drafts and the closed executor. No business requests are replayed. */
        }
      }
    } finally {
      connecting = false;
    }
  }
  window.addEventListener('online', () => void reconnect());
  window.addEventListener('focus', () => void reconnect());
  await attach(initial);
  return initial;
}
