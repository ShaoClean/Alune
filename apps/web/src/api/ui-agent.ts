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
export async function connectUiAgent() {
  const desktop = window.aluneAgent;
  if (!desktop && import.meta.env.MODE !== 'agent') return;
  if (desktop) await desktop.open();
  const client = new AgentClient(frameTransport(desktop ?? (await webChannel())));
  try {
    await client.initialize({ name: 'alune-ui', version: __APP_VERSION__ });
    await client.subscribe(
      location.pathname === '/logs' ? ['diagnostics.logs.changed'] : workspaceTopics,
    );
    uiAgent = client;
    window.addEventListener('pagehide', () => client.close(), { once: true });
    return client;
  } catch (error) {
    client.close();
    throw error;
  }
}
