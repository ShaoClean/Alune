import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Browser acceptance fixture: no SSH, GitHub downloads or real installation.
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const notes = await readFile(new URL('./fixtures/update-notes.md', import.meta.url), 'utf8');

function setup(notes) {
  const subscribers = new Set();
  const calls = [];
  let state = {
    revision: 0,
    status: 'idle',
    currentVersion: '0.2.0',
    latestVersion: null,
    platform: 'darwin',
    installMode: 'restart',
    supported: true,
    releaseNotes: '',
    background: false,
    progress: null,
    error: null,
  };
  const set = (patch) => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    subscribers.forEach((callback) => callback(state));
    return Promise.resolve(state);
  };
  window.__updateFixture = { set, calls };
  window.desktopUpdates = {
    getState: async () => state,
    subscribe: (callback) => {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    check: () => {
      calls.push('check');
      return set({ status: 'available', latestVersion: '0.2.1', releaseNotes: notes });
    },
    download: () => {
      calls.push('download');
      return set({
        status: 'downloading',
        progress: { percent: 45, transferred: 45, total: 100, bytesPerSecond: 10 },
      });
    },
    cancel: () => {
      calls.push('cancel');
      return set({ status: 'available', progress: null });
    },
    install: () => {
      calls.push('install');
      return set({ status: 'installing' });
    },
    openFile: () => {
      calls.push('openFile');
      return Promise.resolve(state);
    },
    revealFile: () => {
      calls.push('revealFile');
      return Promise.resolve(state);
    },
  };
}

const script = `<script>(${setup.toString()})(${JSON.stringify(notes).replaceAll('<', '\\u003c')})</script>`;
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (request.method !== 'GET') {
    response.writeHead(405).end();
    return;
  }
  if (pathname.startsWith('/api/')) {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end('[]');
    return;
  }
  const file = path.resolve(root, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
  if (!file.startsWith(root)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' }[
      path.extname(file)
    ];
    const content = await readFile(file, 'utf8');
    response.writeHead(200, { 'Content-Type': type || 'application/octet-stream' });
    response.end(
      file.endsWith('index.html') ? content.replace('<head>', `<head>${script}`) : content,
    );
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1', () =>
  console.log(`Update fixture: http://127.0.0.1:${server.address().port}`),
);
