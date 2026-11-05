// Dev-only gateway. No service token or Agent/native imports in the browser.
import { type Plugin } from 'vite';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import { MAX_FRAME_BYTES } from '@alune/protocol';
import { launchUiAgent } from '@alune/agent-client/node';

export function agentDev(): Plugin {
  return {
    name: 'alune-dev-agent',
    async configureServer(server) {
      const http = server.httpServer;
      if (!http || server.config.server.host !== '127.0.0.1')
        throw new Error('Agent development requires a private IPv4 loopback server');
      const entry = join(
        createRequire(import.meta.url).resolve('@alune/agent'),
        '../../bin/alune-agent.cjs',
      );
      const host = await launchUiAgent(
        process.execPath,
        entry,
        process.env.ALUNE_AGENT_DATA_DIR ?? join(homedir(), '.alune', 'agent'),
      );
      const ws = new WebSocketServer({
        noServer: true,
        maxPayload: MAX_FRAME_BYTES,
        perMessageDeflate: false,
      });
      http.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/__alune_agent/')) return;
        const role =
          req.url === '/__alune_agent/workspace'
            ? 'workspace'
            : req.url === '/__alune_agent/logs'
              ? 'logs'
              : null;
        const address = http.address();
        const authority = address && typeof address === 'object' ? '127.0.0.1:' + address.port : '';
        if (
          !role ||
          !authority ||
          req.headers.host !== authority ||
          req.headers.origin !== 'http://' + authority ||
          req.socket.remoteAddress !== '127.0.0.1'
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
      http.once('close', () => {
        ws.close();
        void host.close();
      });
      return () => {};
    },
  };
}
