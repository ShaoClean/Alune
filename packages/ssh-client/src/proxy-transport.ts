import * as net from 'node:net';
import * as tls from 'node:tls';
import * as http from 'node:http';
import * as https from 'node:https';
import { Agent } from 'undici';
import { SocksClient } from 'socks';
import type { ProxyProtocol } from '@alune/shared';

// Runtime-only: never serialize this object or pass it to the renderer/remote host.
export interface ProxySnapshot {
  revision: string;
  enabled: boolean;
  protocol: ProxyProtocol;
  host: string;
  port: number;
  credentials?: { username: string; password: string };
}

export class ProxyTransportError extends Error {
  constructor(readonly code: 'PROXY_AUTH' | 'PROXY_TLS' | 'PROXY_CONNECT' | 'PROXY_TIMEOUT') {
    super(
      {
        PROXY_AUTH: '代理认证失败，请检查已保存的用户名和密码。',
        PROXY_TLS: '代理 TLS 证书验证失败，请检查证书与服务器地址。',
        PROXY_CONNECT: '代理无法建立连接，请检查地址、端口、目标访问权限与网络。',
        PROXY_TIMEOUT: '代理连接超时，请检查网络后重试。',
      }[code],
    );
  }
}

function safeError(error: unknown): ProxyTransportError {
  if (error instanceof ProxyTransportError) return error;
  const code = String((error as NodeJS.ErrnoException)?.code || '');
  return new ProxyTransportError(
    /CERT|TLS|SSL|SELF_SIGNED/.test(code) ? 'PROXY_TLS' : 'PROXY_CONNECT',
  );
}

function authority(host: string, port: number): string {
  return `${net.isIP(host) === 6 ? `[${host}]` : host}:${port}`;
}

export async function connectProxySocket(
  proxy: ProxySnapshot,
  host: string,
  port: number,
  signal?: AbortSignal,
): Promise<net.Socket> {
  signal?.throwIfAborted();
  if (!host || /[\s\x00-\x1f/@]/.test(host) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new ProxyTransportError('PROXY_CONNECT');
  const deadline = AbortSignal.timeout(20_000);
  const cancel = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let socket: net.Socket | undefined;
  let request: http.ClientRequest | undefined;
  const abort = () => {
    socket?.destroy();
    request?.destroy(new ProxyTransportError('PROXY_TIMEOUT'));
  };
  cancel.addEventListener('abort', abort, { once: true });
  try {
    if (!proxy.enabled || proxy.protocol === 'socks5') {
      socket = net.createConnection({
        host: proxy.enabled ? proxy.host : host,
        port: proxy.enabled ? proxy.port : port,
      });
      await new Promise<void>((resolve, reject) => {
        socket!.once('connect', resolve);
        socket!.once('error', reject);
        socket!.once('close', () => reject(new ProxyTransportError('PROXY_CONNECT')));
      });
      if (proxy.enabled) {
        try {
          const result = await SocksClient.createConnection({
            command: 'connect',
            proxy: {
              host: proxy.host,
              port: proxy.port,
              type: 5,
              userId: proxy.credentials?.username,
              password: proxy.credentials?.password,
            },
            destination: { host, port }, // Domain names are resolved by the proxy.
            existing_socket: socket,
            timeout: 20_000,
          });
          socket = result.socket;
        } catch (error) {
          // The library's raw message can include proxy options; return only our own text.
          throw new ProxyTransportError(
            /auth/i.test(String((error as Error).message)) ? 'PROXY_AUTH' : 'PROXY_CONNECT',
          );
        }
      }
    } else {
      socket = await new Promise<net.Socket>((resolve, reject) => {
        request = (proxy.protocol === 'https' ? https : http).request({
          host: proxy.host,
          port: proxy.port,
          // CONNECT's Host header names the destination, but TLS authenticates
          // the proxy itself. Never derive the TLS name from that header.
          servername: net.isIP(proxy.host) ? '' : proxy.host,
          rejectUnauthorized: true,
          method: 'CONNECT',
          path: authority(host, port),
          agent: false,
          headers: {
            Host: authority(host, port),
            ...(proxy.credentials
              ? {
                  'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.credentials.username}:${proxy.credentials.password}`).toString('base64')}`,
                }
              : {}),
          },
        });
        request.once('error', reject);
        request.once('connect', (response, tunnel, head) => {
          if (response.statusCode !== 200) {
            tunnel.destroy();
            reject(
              new ProxyTransportError(response.statusCode === 407 ? 'PROXY_AUTH' : 'PROXY_CONNECT'),
            );
          } else {
            if (head.length) tunnel.unshift(head);
            resolve(tunnel);
          }
        });
        request.end();
      });
    }
    cancel.throwIfAborted();
    return socket;
  } catch (error) {
    socket?.destroy();
    request?.destroy();
    if (signal?.aborted) throw signal.reason;
    if (deadline.aborted) throw new ProxyTransportError('PROXY_TIMEOUT');
    throw safeError(error);
  } finally {
    cancel.removeEventListener('abort', abort);
  }
}

export function createProxyDispatcher(proxy: ProxySnapshot): Agent {
  return new Agent({
    connect(options, callback) {
      const host = options.hostname.replace(/^\[|\]$/g, '');
      const port = Number(options.port || (options.protocol === 'https:' ? 443 : 80));
      void connectProxySocket(proxy, host, port).then(
        (socket) => {
          if (options.protocol !== 'https:') return callback(null, socket);
          const secured = tls.connect({
            socket,
            host,
            servername: net.isIP(host) ? undefined : host,
            rejectUnauthorized: true,
            ALPNProtocols: ['http/1.1'],
          });
          const timeout = setTimeout(
            () => secured.destroy(new ProxyTransportError('PROXY_TIMEOUT')),
            20_000,
          );
          const failed = (error: Error) => {
            clearTimeout(timeout);
            callback(safeError(error), null);
          };
          secured.once('error', failed);
          secured.once('secureConnect', () => {
            clearTimeout(timeout);
            secured.removeListener('error', failed);
            callback(null, secured);
          });
        },
        (error) => callback(safeError(error), null),
      );
    },
  });
}

// A credential-free HTTP endpoint for Electron and reverse SSH forwarding.
// Each accepted request captures its own immutable configuration; saving never
// destroys sockets that belong to work already in progress.
export async function createProxyBridge(snapshot: () => ProxySnapshot) {
  const sockets = new Set<net.Socket>();
  const controllers = new Set<AbortController>();
  const track = (socket: net.Socket) => {
    sockets.add(socket);
    socket.once('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    return socket;
  };
  const tunnel = async (host: string, port: number, downstream: net.Socket) => {
    const controller = new AbortController();
    controllers.add(controller);
    const abort = () => controller.abort();
    downstream.once('close', abort);
    try {
      return track(await connectProxySocket(snapshot(), host, port, controller.signal));
    } finally {
      controllers.delete(controller);
      downstream.removeListener('close', abort);
    }
  };
  const server = http.createServer(async (incoming, outgoing) => {
    let agent: http.Agent | undefined;
    try {
      const url = new URL(incoming.url || '');
      if (url.protocol !== 'http:' || url.username || url.password) throw new Error();
      const socket = await tunnel(
        url.hostname.replace(/^\[|\]$/g, ''),
        Number(url.port || 80),
        incoming.socket,
      );
      agent = new http.Agent({ keepAlive: false });
      agent.createConnection = () => socket;
      const headers: http.OutgoingHttpHeaders = { ...incoming.headers, host: url.host };
      delete headers['proxy-authorization'];
      delete headers['proxy-connection'];
      const request = http.request(url, { agent, method: incoming.method, headers }, (response) => {
        outgoing.writeHead(response.statusCode || 502, response.headers);
        response.pipe(outgoing);
      });
      request.on('error', () => outgoing.destroy());
      outgoing.once('close', () => {
        request.destroy();
        agent?.destroy();
      });
      incoming.pipe(request);
    } catch {
      agent?.destroy();
      outgoing.writeHead(502);
      outgoing.end('Proxy connection failed');
    }
  });
  server.on('connection', track);
  server.on('connect', (request, downstream, head) => {
    void (async () => {
      const target = new URL(`http://${request.url}`);
      if (
        target.username ||
        target.password ||
        target.pathname !== '/' ||
        target.search ||
        target.hash
      )
        throw new Error();
      const upstream = await tunnel(
        target.hostname.replace(/^\[|\]$/g, ''),
        Number(target.port || 80),
        downstream as net.Socket,
      );
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      downstream.once('close', () => upstream.destroy());
      upstream.once('close', () => downstream.destroy());
      downstream.pipe(upstream).pipe(downstream);
    })().catch(() => downstream.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'));
  });
  server.on('clientError', (_error, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close() {
      for (const controller of controllers) controller.abort();
      for (const socket of sockets) socket.destroy();
      server.close();
    },
  };
}
