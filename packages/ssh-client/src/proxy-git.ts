import type { SSHConnection } from './connection-manager';
import { gitFileCommand, quotePosixArgument } from './git-shell';
import { deflateSync } from 'node:zlib';

export class GitProxyError extends Error {}

export const isLoopbackAddress = (address: string) =>
  /^127\.\d+\.\d+\.\d+$/.test(address) ||
  /^::ffff:127\.\d+\.\d+\.\d+$/i.test(address) ||
  address === '::1';

const python = (script: string) =>
  `python3 -c "exec(__import__('zlib').decompress(__import__('base64').b64decode('${deflateSync(script).toString('base64')}')))"`;

const connectScript = `import os,socket,sys,threading
s=socket.create_connection(('127.0.0.1',int(sys.argv[3])),20)
h=sys.argv[1];p=int(sys.argv[2]);h=('['+h+']') if ':' in h else h
s.sendall(('CONNECT '+h+':'+str(p)+' HTTP/1.1\\r\\nHost: '+h+':'+str(p)+'\\r\\n\\r\\n').encode())
b=b''
while b'\\r\\n\\r\\n' not in b:
 d=s.recv(1)
 if not d or len(b)>16384: sys.exit(72)
 b+=d
if b.split(b' ')[1]!=b'200': sys.exit(73)
s.settimeout(None)
if os.name=='nt':
 import msvcrt
 msvcrt.setmode(sys.stdin.fileno(),os.O_BINARY);msvcrt.setmode(sys.stdout.fileno(),os.O_BINARY)
def send():
 try:
  while True:
   d=os.read(sys.stdin.fileno(),65536)
   if not d: s.shutdown(socket.SHUT_WR);break
   s.sendall(d)
 except OSError: pass
threading.Thread(target=send,daemon=True).start()
while True:
 d=s.recv(65536)
 if not d: break
 sys.stdout.buffer.write(d);sys.stdout.buffer.flush()
`;

// ProxyCommand runs under the remote user's $SHELL; sh -c keeps the probe POSIX
// even for fish. Avoid backslashes and percent signs: fish single quotes and ssh
// token expansion would alter them. Git for Windows ships connect.exe; Python
// stays last so hosts without netcat-style tools keep working.
export function sshProxyCommand(port: number) {
  const script = [
    'h=$1 p=$2',
    `if nc -h 2>&1 | grep -q -e -X; then exec nc -X connect -x 127.0.0.1:${port} "$h" "$p"; fi`,
    `if command -v ncat >/dev/null 2>&1; then exec ncat --proxy 127.0.0.1:${port} --proxy-type http "$h" "$p"; fi`,
    `if command -v connect >/dev/null 2>&1; then exec connect -H 127.0.0.1:${port} "$h" "$p"; fi`,
    `case $h in *:*) ;; *) if command -v socat >/dev/null 2>&1; then exec socat - "PROXY:127.0.0.1:$h:$p,proxyport=${port}"; fi;; esac`,
    `if command -v python3 >/dev/null 2>&1; then exec ${python(connectScript)} "$h" "$p" ${port}; fi`,
    'echo "Alune: 远端缺少 SSH 代理工具（nc、ncat、connect、socat 或 python3 任一），SSH 协议的远程地址无法经代理连接；HTTPS 远程地址不受影响。" >&2',
    'exit 1',
  ].join('; ');
  return `sh -c ${quotePosixArgument(script)} alune %h %p`;
}

export async function proxyGitArguments(
  connection: SSHConnection,
  path: string,
  args: string[],
  port: number,
  signal?: AbortSignal,
  environment?: Record<string, string>,
): Promise<string> {
  const proxy = `http://127.0.0.1:${port}`;
  const config = await connection.execCommand(
    gitFileCommand(path, [
      'config',
      '--name-only',
      '--get-regexp',
      '^(http\\..*\\.proxy|remote\\..*\\.proxy)$',
    ]),
    undefined,
    signal,
    { maxOutputBytes: 65_536 },
  );
  if (config.exitCode !== 0 && config.exitCode !== 1)
    throw new GitProxyError('无法读取远端仓库的代理覆盖项，已中止网络操作。');
  const overrides = config.stdout
    .split('\n')
    .filter(Boolean)
    .flatMap((key) => ['-c', `${key}=${proxy}`]);
  const sshProxy = sshProxyCommand(port);
  const ssh = `ssh -o ${quotePosixArgument(`ProxyCommand=${sshProxy}`)} -o ProxyJump=none -o ControlMaster=no -o ControlPath=none -o CanonicalizeHostname=no -o ProxyUseFdpass=no -o BatchMode=yes -o ConnectTimeout=20 -o PermitLocalCommand=no`;
  return gitFileCommand(
    path,
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
      ...environment,
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_VARIANT: 'ssh',
      GIT_SSH_COMMAND: ssh,
      NO_PROXY: '',
      no_proxy: '',
    },
  );
}
