import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Isolated, read-only fixture for browser acceptance. Never connects to SSH.
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const connections = ['开发服务器', '测试服务器', '归档服务器'].map((name, index) => ({
  id: `connection-${index + 1}`, name, host: 'fixture.invalid', port: 22, username: 'fixture', authType: 'sshAgent',
}));
const repositories = connections.flatMap((connection, index) => Array.from({ length: index === 2 ? 35 : 3 }, (_, number) => ({
  id: `repo-${index + 1}-${number + 1}`, connectionId: connection.id,
  name: ['remote-git', '业务服务', '工具仓库'][number] || `archive-${number + 1}`,
  path: `/workspace/${connection.id}/repository-${number + 1}`, isDirty: number === 1,
})));
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  if (pathname.startsWith('/api/')) {
    let result = [];
    if (pathname === '/api/connections') result = connections;
    else if (pathname === '/api/repositories') result = repositories;
    else if (pathname.endsWith('/status')) result = { branch: 'main', files: [], ahead: 0, behind: 0 };
    else if (/^\/api\/repositories\/[^/]+$/.test(pathname)) result = repositories.find((repo) => repo.id === pathname.split('/').at(-1));
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    return;
  }
  const file = path.resolve(root, pathname.startsWith('/assets/') ? `.${pathname}` : 'index.html');
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    const content = await readFile(file);
    const type = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' }[path.extname(file)] || 'application/octet-stream';
    response.writeHead(200, { 'Content-Type': type }).end(content);
  } catch { response.writeHead(404).end(); }
});
server.listen(0, '127.0.0.1', () => console.log(`Sidebar fixture: http://127.0.0.1:${server.address().port}`));
