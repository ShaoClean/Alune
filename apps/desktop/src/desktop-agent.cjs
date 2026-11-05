const { createServer } = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { AgentClient, frameTransport, launchUiAgent } = require('@alune/agent-client/node');
const { isTrustedWorkspaceSender } = require('./workspace-preferences.cjs');
const { initializeDesktopState } = require('./agent-import.cjs');
const { createAiSecretStorage } = require('./ai-secret-storage.cjs');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function startDesktopAgent({
  app,
  ipcMain,
  token,
  dataDir,
  windowContents,
  logContents,
  smokeTest,
}) {
  const root = app.isPackaged
    ? path.join(process.resourcesPath, 'agent-runtime')
    : path.resolve(__dirname, '../agent-runtime');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  if (
    manifest.version !== app.getVersion() ||
    manifest.target !== process.platform + '-' + process.arch
  )
    throw new Error('本机运行包与此应用的版本或平台不匹配。');
  const node = path.join(
    root,
    process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/bin/node',
  );
  const entry = path.join(root, 'node_modules/@alune/agent/bin/alune-agent.cjs');
  const env = { ...process.env };
  for (const k of ['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE']) delete env[k];
  const directory = path.join(dataDir, 'agent');
  const standalone = path.join(require('node:os').homedir(), '.alune');
  const source =
    !smokeTest &&
    !fs.existsSync(path.join(dataDir, 'alune.db')) &&
    fs.existsSync(path.join(standalone, 'alune.db'))
      ? standalone
      : dataDir;
  await initializeDesktopState(
    { node, entry, env },
    source,
    directory,
    createAiSecretStorage(require('electron').safeStorage),
  );
  const host = await launchUiAgent(node, entry, directory);
  const channels = new Map();
  const webRoot = path.join(__dirname, 'web');
  let origin;
  const server = createServer((request, response) => {
    const finish = (status) => {
      response.writeHead(status);
      response.end();
    };
    if (
      request.headers.authorization !== 'Bearer ' + token ||
      request.headers.host !== new URL(origin).host
    )
      return finish(401);
    if (request.method !== 'GET' && request.method !== 'HEAD') return finish(405);
    let route;
    try {
      route = decodeURIComponent(new URL(request.url, origin).pathname);
    } catch {
      return finish(400);
    }
    if (route.startsWith('/api/') || route.startsWith('/socket.io')) return finish(404);
    const asset = path.extname(route) || route.startsWith('/assets/');
    const file = asset ? path.resolve(webRoot, '.' + route) : path.join(webRoot, 'index.html');
    if (!file.startsWith(webRoot + path.sep) || route.includes('\\') || route.includes('\0'))
      return finish(403);
    fs.readFile(file, (error, data) => {
      if (error) return finish(404);
      response.writeHead(200, {
        'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    });
  });
  const client = new AgentClient(frameTransport(await host.open('native')));
  let stopping = false;
  try {
    const handshake = await client.initialize({ name: 'alune-desktop', version: app.getVersion() });
    if (handshake.implementation.version !== manifest.version)
      throw new Error('本机服务版本不匹配。');
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    origin = 'http://127.0.0.1:' + server.address().port;
    const role = (e) =>
      isTrustedWorkspaceSender(e, windowContents(), origin)
        ? 'workspace'
        : isTrustedWorkspaceSender(e, logContents(), origin)
          ? 'logs'
          : null;
    ipcMain.handle('agent:open', async (e) => {
      const name = role(e),
        contents = e.sender,
        frame = e.senderFrame;
      if (stopping || !name || channels.has(contents)) throw new Error('Agent channel unavailable');
      const channel = await host.open(name);
      if (
        !role(e) ||
        contents.isDestroyed() ||
        contents.mainFrame !== frame ||
        channels.has(contents)
      ) {
        channel.close();
        throw new Error('Agent window changed');
      }
      const cleanup = () => {
        if (channels.get(contents)?.channel !== channel) return;
        channels.delete(contents);
        channel.close();
        contents.off('did-start-navigation', navigate);
        contents.off('destroyed', cleanup);
        contents.off('render-process-gone', cleanup);
      };
      const navigate = (_e, details, inPlace, main) => {
        if (
          typeof details === 'object'
            ? details.isMainFrame && !details.isSameDocument
            : main && !inPlace
        )
          cleanup();
      };
      const generation = require('node:crypto').randomUUID();
      channels.set(contents, { channel, cleanup, generation });
      contents.on('did-start-navigation', navigate);
      contents.once('destroyed', cleanup);
      contents.once('render-process-gone', cleanup);
      channel.onFrame((value) => {
        if (!contents.isDestroyed() && contents.mainFrame === frame)
          frame.send('agent:frame', generation, value);
      });
      channel.onEnd(() => {
        if (!contents.isDestroyed() && contents.mainFrame === frame)
          frame.send('agent:end', generation);
        cleanup();
      });
      return generation;
    });
    ipcMain.handle('agent:frame', async (e, generation, value) => {
      const endpoint = role(e) && channels.get(e.sender);
      if (stopping || !endpoint || endpoint.generation !== generation) return false;
      await endpoint.channel.send(value);
      return true;
    });
    ipcMain.handle('agent:close', (e, generation) => {
      const endpoint = role(e) && channels.get(e.sender);
      if (endpoint && generation === endpoint.generation) endpoint.cleanup();
    });
    const { ProxyAgent, fetch: networkFetch } = require('undici');
    let proxy, port;
    const networkProxy = {
      updaterBridge: () => client.updaterBridge(),
      async fetch(url, init) {
        const bridge = await client.updaterBridge();
        if (bridge.enabled && port !== bridge.port) {
          const old = proxy;
          proxy = new ProxyAgent('http://127.0.0.1:' + bridge.port);
          port = bridge.port;
          if (old) void old.close().catch(() => {});
        }
        return networkFetch(url, { ...init, dispatcher: bridge.enabled ? proxy : undefined });
      },
    };
    return {
      origin,
      client,
      networkProxy,
      registry: {
        impact: () => client.request('desktop.terminals.impact', {}),
        remove: (_scope, ids) => client.request('desktop.terminals.remove', ids),
      },
      async close() {
        stopping = true;
        for (const c of channels.values()) c.cleanup();
        client.close();
        server.closeAllConnections();
        server.close();
        try {
          await proxy?.destroy();
        } finally {
          await host.close();
        }
      },
    };
  } catch (error) {
    client.close();
    server.close();
    await host.close();
    throw error;
  }
}
module.exports = { startDesktopAgent };
