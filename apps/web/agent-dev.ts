// Dev-only gateway. No service token or Agent/native imports in the browser.
import { type Plugin } from 'vite';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { MAX_FRAME_BYTES } from '@alune/protocol';
import { superviseUiAgent } from '@alune/agent-client/node';

export function agentDev(): Plugin {
  let dispose: (() => Promise<void>) | undefined;
  return {
    async closeBundle() {
      await dispose?.();
    },
    name: 'alune-dev-agent',
    async configureServer(server) {
      const http = server.httpServer;
      if (!http || server.config.server.host !== '127.0.0.1')
        throw new Error('Agent development requires a private IPv4 loopback server');
      const entry = join(
        createRequire(import.meta.url).resolve('@alune/agent'),
        '../../bin/alune-agent.cjs',
      );
      const legacy =
        process.env.ALUNE_AGENT_LEGACY_DIR ??
        (!process.env.ALUNE_AGENT_DATA_DIR ? join(homedir(), '.alune') : undefined);
      const data = process.env.ALUNE_AGENT_DATA_DIR ?? join(homedir(), '.alune', 'agent'),
        marker = join(data, 'web-import.json');
      if (legacy && existsSync(join(legacy, 'alune.db'))) {
        if (existsSync(marker)) {
          const proof = JSON.parse(await readFile(marker, 'utf8'));
          if (proof.source !== legacy || !existsSync(join(data, 'identity.json')))
            throw Error('旧数据导入记录不匹配，请恢复备份。');
        } else {
          const imported = await promisify(execFile)(
            process.execPath,
            [entry, 'legacy-import', '--source', legacy, '--data-dir', data],
            { timeout: 180000 },
          );
          await writeFile(
            marker + '.tmp',
            JSON.stringify({ source: legacy, receipt: JSON.parse(imported.stdout) }),
            { mode: 0o600 },
          );
          await rename(marker + '.tmp', marker);
        }
      }
      const host = await superviseUiAgent(
        process.execPath,
        entry,
        data,
        JSON.parse(await readFile(join(entry, '../../dist/version.json'), 'utf8')).version,
      );
      const ws = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_FRAME_BYTES,
        perMessageDeflate: false,
      });
      const invite = randomBytes(32).toString('hex');
      const localRequest = (req: IncomingMessage) => {
        const address = http.address();
        if (!address || typeof address !== 'object') return false;
        const authority = req.headers.host;
        return (
          (authority === '127.0.0.1:' + address.port ||
            authority === 'localhost:' + address.port) &&
          req.headers.origin === 'http://' + authority &&
          req.socket.remoteAddress === '127.0.0.1'
        );
      };
      http.once('listening', () => {
        const address = http.address();
        if (address && typeof address === 'object')
          server.config.logger.info(
            '打开本机工作区：http://127.0.0.1:' + address.port + '/#alune-session=' + invite,
          );
      });
      http.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/__alune_agent/')) return;
        const role =
          req.url === '/__alune_agent/workspace'
            ? 'workspace'
            : req.url === '/__alune_agent/logs'
              ? 'logs'
              : null;
        if (
          !role ||
          !localRequest(req) ||
          req.headers['sec-websocket-protocol'] !== 'alune.' + invite
        ) {
          socket.destroy();
          return;
        }
        ws.handleUpgrade(req, socket, head, (peer) => {
          peer.pause();
          peer.on('error', () => peer.terminate());
          void host.open(role).then(
            (channel) => {
              if (peer.readyState !== WebSocket.OPEN) {
                channel.close();
                return;
              }
              peer.once('close', () => channel.close());
              channel.onFrame((frame) => {
                if (peer.bufferedAmount > 2 * MAX_FRAME_BYTES) peer.terminate();
                else
                  peer.send(frame, (err) => {
                    if (err) peer.terminate();
                  });
              });
              channel.onEnd(() => peer.terminate());
              peer.on('message', (data, binary) => {
                if (binary) peer.terminate();
                else void channel.send(data.toString()).catch(() => peer.terminate());
              });
              peer.resume();
            },
            () => peer.terminate(),
          );
        });
      });
      dispose = async () => {
        for (const peer of ws.clients) peer.terminate();
        ws.close();
        await host.close();
      };
      http.once('close', () => {
        void host.close();
      });
      return () => {};
    },
  };
}
