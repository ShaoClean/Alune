import { quotePosixArgument } from './git-shell';
import { GitProxyError } from './proxy-git';
import { createProxyBridge } from './proxy-transport';
import type { ProxySnapshot } from './proxy-transport';
import type { CommandOptions } from './repository-transport';
import type { CommandResult } from './connection-manager';

// Run with the application's Node/Electron runtime, so local SSH remotes do not
// require Python, netcat, or an installed Node executable. No credentials enter
// the helper's arguments or environment; it can only reach the loopback bridge.
const connectScript = `
const net = require('node:net');
const [host, targetPort, bridgePort] = process.argv.slice(1);
const authority = (host.includes(':') ? '[' + host + ']' : host) + ':' + targetPort;
const socket = net.connect(Number(bridgePort), '127.0.0.1');
const fail = () => { process.stderr.write('Git proxy tunnel failed\\n'); process.exit(1); };
socket.on('error', fail);
process.stdout.on('error', () => process.exit(1));
socket.setTimeout(20000, fail);
socket.once('connect', () => socket.write('CONNECT ' + authority + ' HTTP/1.1\\r\\nHost: ' + authority + '\\r\\n\\r\\n'));
let header = Buffer.alloc(0);
const handshake = chunk => {
  header = Buffer.concat([header, chunk]);
  const boundary = header.indexOf('\\r\\n\\r\\n');
  if (boundary < 0) { if (header.length > 16384) fail(); return; }
  if (header.subarray(0, boundary).toString().split(' ')[1] !== '200') return fail();
  socket.removeListener('data', handshake);
  socket.removeListener('end', fail);
  socket.setTimeout(0);
  if (header.length > boundary + 4) process.stdout.write(header.subarray(boundary + 4));
  socket.pipe(process.stdout);
  process.stdin.pipe(socket);
  socket.once('end', () => { process.stdin.unpipe(socket); process.stdin.pause(); });
};
socket.on('data', handshake);
socket.once('end', fail);
`;

export async function withLocalGitProxy(
  snapshot: ProxySnapshot,
  args: string[],
  options: CommandOptions,
  execute: (args: string[], options: CommandOptions) => Promise<CommandResult>,
): Promise<CommandResult> {
  const config = await execute(
    ['config', '--name-only', '--get-regexp', '^(http\\..*\\.proxy|remote\\..*\\.proxy)$'],
    { environment: options.environment, maxOutputBytes: 65_536 },
  );
  if (config.exitCode !== 0 && config.exitCode !== 1)
    throw new GitProxyError('无法读取本地仓库的代理覆盖项，已中止网络操作。');
  const bridge = await createProxyBridge(() => snapshot);
  try {
    const proxy = `http://127.0.0.1:${bridge.port}`;
    const overrides = config.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((key) => ['-c', `${key}=${proxy}`]);
    const executable =
      process.platform === 'win32'
        ? `"${process.execPath.replace(/\\/g, '/')}"`
        : quotePosixArgument(process.execPath);
    const script = `eval(Buffer.from('${Buffer.from(connectScript).toString('base64')}','base64').toString())`;
    const helper = `${executable} -e "${script}" %h %p ${bridge.port}`;
    const ssh = `ssh -o ${quotePosixArgument(`ProxyCommand=${helper}`)} -o ProxyJump=none -o ControlMaster=no -o ControlPath=none -o CanonicalizeHostname=no -o ProxyUseFdpass=no -o BatchMode=yes -o ConnectTimeout=20 -o PermitLocalCommand=no`;
    return await execute(
      [
        '-c',
        `http.proxy=${proxy}`,
        ...overrides,
        '-c',
        'protocol.allow=never',
        '-c',
        'protocol.http.allow=always',
        '-c',
        'protocol.https.allow=always',
        '-c',
        'protocol.ssh.allow=always',
        '-c',
        'protocol.file.allow=always',
        ...args,
      ],
      {
        ...options,
        environment: {
          ...options.environment,
          GIT_SSH_VARIANT: 'ssh',
          GIT_SSH_COMMAND: ssh,
          // protocol.allow alone cannot override protocol.<helper>.allow=always.
          GIT_ALLOW_PROTOCOL: 'http:https:ssh:file',
          ELECTRON_RUN_AS_NODE: '1',
          NO_PROXY: '',
          no_proxy: '',
        },
      },
    );
  } finally {
    bridge.close();
  }
}
