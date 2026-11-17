const path = require('node:path');
const fs = require('node:fs');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { bridgeLegacyAgentSecrets } = require('./legacy-agent-secrets.cjs');
const files = [
  'alune.db',
  'workspace.json',
  'network-proxy.json',
  'ai-settings.json',
  'logging.json',
];

async function initializeDesktopState({ node, entry, env }, source, directory, storage) {
  fs.mkdirSync(directory, { mode: 0o700, recursive: true });
  const marker = path.join(directory, 'desktop-import.json');
  if (fs.existsSync(marker)) {
    const receipt = JSON.parse(fs.readFileSync(marker, 'utf8'));
    if (
      receipt.version !== 1 ||
      receipt.source !== source ||
      !fs.existsSync(path.join(directory, 'identity.json'))
    )
      throw new Error('迁移记录与数据目录不匹配，请恢复备份。');
    return;
  }
  if (!files.some((file) => fs.existsSync(path.join(source, file)))) return;
  const { stdout } = await promisify(execFile)(
    node,
    [entry, 'legacy-ciphertext-hashes', '--source', source],
    { env, windowsHide: true, timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
  );
  const hashes = JSON.parse(stdout);
  const child = spawn(node, [entry, 'legacy-import', '--source', source, '--data-dir', directory], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let diagnostic = 'import-validation';
  const dispose = bridgeLegacyAgentSecrets(child, storage, hashes, {
    hashed: true,
    onFailure: (reason) => {
      diagnostic = reason;
    },
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
  let output = '',
    error = '';
  child.stdout.on('data', (chunk) => {
    if (output.length < 65536) output += chunk;
  });
  child.stderr.on('data', (chunk) => {
    if (error.length < 8192) error += chunk;
  });
  try {
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    if (code !== 0)
      throw new Error('旧数据迁移失败，原始数据已保留。' + error.trim() + ' (' + diagnostic + ')');
    const receipt = JSON.parse(output);
    if (!/^[0-9a-f-]{36}$/.test(receipt.sourceBackupId)) throw new Error('无效的迁移回执。');
    const workspace = path.join(
      directory,
      'migration-sources',
      receipt.sourceBackupId,
      'workspace.json',
    );
    const destination = path.join(directory, 'workspace.json');
    if (fs.existsSync(workspace)) {
      fs.copyFileSync(workspace, destination + '.tmp');
      fs.renameSync(destination + '.tmp', destination);
    }
    fs.writeFileSync(marker + '.tmp', JSON.stringify({ version: 1, source, receipt }), 'utf8');
    fs.renameSync(marker + '.tmp', marker);
  } finally {
    clearTimeout(timer);
    dispose();
  }
}
module.exports = { initializeDesktopState };
