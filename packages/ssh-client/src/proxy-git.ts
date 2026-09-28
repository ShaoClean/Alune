import type { SSHConnection } from './connection-manager';
import { gitFileCommand, quotePosixArgument } from './git-shell';
import { deflateSync } from 'node:zlib';

export class GitProxyError extends Error {}

const python = (script: string) =>
  `python3 -c "exec(__import__('zlib').decompress(__import__('base64').b64decode('${deflateSync(script).toString('base64')}')))"`;

// This helper has no credentials and installs no files on the remote machine.
// Check the actual listener: sshd GatewayPorts=yes can override a loopback bind.
const checkListener = `import os,sys,subprocess
p=int(sys.argv[1]); found=[]
if os.path.exists('/proc/net/tcp'):
 for f in ['/proc/net/tcp','/proc/net/tcp6']:
  if not os.path.exists(f): continue
  for line in open(f).readlines()[1:]:
   a=line.split()
   if a[3]=='0A' and int(a[1].split(':')[1],16)==p: found.append(a[1].split(':')[0]=='0100007F')
else:
 for line in subprocess.check_output(['netstat','-an'],text=True).splitlines():
  a=line.split()
  if 'LISTEN' not in line.upper(): continue
  for v in a:
   if v.endswith(':'+str(p)) or v.endswith('.'+str(p)):
    found.append(v in ['127.0.0.1:'+str(p),'127.0.0.1.'+str(p)]); break
sys.exit(0 if found and all(found) else 71)
`;

export async function verifyLoopbackForward(connection: SSHConnection, port: number) {
  const result = await connection.execCommand(
    `${python(checkListener)} ${port}`,
    undefined,
    AbortSignal.timeout(15_000),
    { maxOutputBytes: 16_384 },
  );
  if (result.exitCode === 71)
    throw new GitProxyError(
      '无法确认远端入口仅监听 127.0.0.1，已关闭转发；请检查 GatewayPorts 设置和监听权限。',
    );
  if (result.exitCode !== 0)
    throw new GitProxyError(
      '远端 Git 代理需要可执行的 Python 3，以及读取监听端口的权限（非 Linux 系统还需 netstat）；请由管理员配置后重新连接。',
    );
}

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

export async function proxyGitArguments(
  connection: SSHConnection,
  path: string,
  args: string[],
  port: number,
  signal?: AbortSignal,
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
  const sshProxy = `${python(connectScript)} %h %p ${port}`;
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
      GIT_TERMINAL_PROMPT: '0',
      GIT_SSH_VARIANT: 'ssh',
      GIT_SSH_COMMAND: ssh,
      NO_PROXY: '',
      no_proxy: '',
    },
  );
}
