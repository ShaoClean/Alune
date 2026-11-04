// Build an isolated, self-contained Node Agent directory for the current host.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url));
const runtimeVersion = '22.22.0';
const targets = new Set(['darwin-arm64', 'darwin-x64', 'linux-x64', 'win32-x64']);
const target = `${process.platform}-${process.arch}`;
if (!targets.has(target)) throw new Error(`Unsupported Agent target: ${target}`);
const argv = process.argv.slice(2);
if (argv.length !== 2 || argv[0] !== '--output')
  throw new Error('Usage: node scripts/agent/package.mjs --output NEW_DIRECTORY');
const output = path.resolve(argv[1]);
if (fs.existsSync(output)) throw new Error('Output directory already exists; use a new directory');
// Verification must not resolve missing modules from the checkout's node_modules.
if (output === root || output.startsWith(root + path.sep))
  throw new Error('Use an output directory outside the checkout');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-agent-package-'));
const runtimeName = `node-v${runtimeVersion}-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;
const archiveName = runtimeName + (process.platform === 'win32' ? '.zip' : '.tar.gz');
const baseURL = `https://nodejs.org/dist/v${runtimeVersion}/`;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const packages = new Map();
const copied = new Map();

async function download(name, limit) {
  const response = await fetch(baseURL + name, { signal: AbortSignal.timeout(180000) });
  if (!response.ok || !response.body) throw new Error(`Node download failed: ${response.status}`);
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error('Node download exceeded expected size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function packageDirectory(name, parent) {
  const require = createRequire(path.join(parent, 'package.json'));
  try {
    return path.dirname(require.resolve(name + '/package.json'));
  } catch {
    let directory = path.dirname(require.resolve(name));
    while (directory !== path.dirname(directory)) {
      const file = path.join(directory, 'package.json');
      if (fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).name) return directory;
      directory = path.dirname(directory);
    }
    throw new Error(`Cannot locate dependency ${name}`);
  }
}
function collect(name, sourceParent, targetParent) {
  const source = fs.realpathSync(packageDirectory(name, sourceParent));
  let cursor = targetParent;
  while (cursor.startsWith(output)) {
    const candidate = path.join(cursor, 'node_modules', name);
    if (copied.has(candidate)) {
      if (copied.get(candidate) === source) return;
      break; // A nearer conflicting version must be overridden in this package.
    }
    if (cursor === output) break;
    cursor = path.dirname(cursor);
  }
  const topLevel = path.join(output, 'node_modules', name);
  const destination = copied.has(topLevel)
    ? path.join(targetParent, 'node_modules', name)
    : topLevel;
  if (copied.get(destination) === source) return;
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8'));
  if (['electron', 'desktop', 'server', 'web'].includes(manifest.name))
    throw new Error('Desktop dependency entered Agent package');
  const workspace = manifest.name.startsWith('@alune/');
  copied.set(destination, source);
  fs.cpSync(source, destination, {
    recursive: true,
    dereference: true,
    filter(file) {
      const rel = path.relative(source, file);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      if (parts.includes('node_modules') || parts.includes('.git')) return false;
      if (workspace)
        return (
          ['dist', 'bin', 'package.json', 'README.md', 'LICENSE'].includes(parts[0]) &&
          !file.endsWith('.tsbuildinfo')
        );
      return true;
    },
  });
  packages.set(path.relative(output, destination).split(path.sep).join('/'), {
    name: manifest.name,
    version: manifest.version,
  });
  for (const dependency of Object.keys(manifest.dependencies ?? {}))
    collect(dependency, source, destination);
  for (const dependency of Object.keys(manifest.optionalDependencies ?? {})) {
    try {
      packageDirectory(dependency, source);
    } catch {
      continue;
    }
    collect(dependency, source, destination);
  }
}
function allFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? allFiles(file) : [file];
  });
}

try {
  const sums = (await download('SHASUMS256.txt', 100000)).toString('utf8');
  const record = sums.split('\n').find((line) => line.trim().endsWith(' ' + archiveName));
  const expected = record?.trim().split(/\s+/)[0];
  if (!expected || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error('Official Node checksum missing');
  const archive = await download(archiveName, 150 * 1024 * 1024);
  if (digest(archive) !== expected) throw new Error('Node archive checksum mismatch');
  const archivePath = path.join(scratch, archiveName);
  fs.writeFileSync(archivePath, archive);
  if (process.platform === 'win32') {
    const script =
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:ALUNE_NODE_ARCHIVE,$env:ALUNE_NODE_UNPACK)';
    execFileSync(
      'powershell.exe',
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64'),
      ],
      {
        env: { ...process.env, ALUNE_NODE_ARCHIVE: archivePath, ALUNE_NODE_UNPACK: scratch },
        stdio: 'pipe',
      },
    );
  } else execFileSync('tar', ['-xzf', archivePath, '-C', scratch]);
  const unpacked = path.join(scratch, runtimeName);
  const nodeRelative = process.platform === 'win32' ? 'runtime/node.exe' : 'runtime/bin/node';
  const nodePath = path.join(output, nodeRelative);
  fs.mkdirSync(path.dirname(nodePath), { recursive: true });
  fs.copyFileSync(
    path.join(unpacked, process.platform === 'win32' ? 'node.exe' : 'bin/node'),
    nodePath,
  );
  fs.chmodSync(nodePath, 0o755);
  fs.copyFileSync(path.join(unpacked, 'LICENSE'), path.join(output, 'runtime/LICENSE'));
  fs.writeFileSync(
    path.join(output, 'package.json'),
    JSON.stringify({ name: 'alune-agent-runtime', private: true, version: '0.0.1' }, null, 2),
  );
  collect('@alune/agent', root, output);
  if (process.platform === 'win32')
    fs.writeFileSync(
      path.join(output, 'alune-agent.cmd'),
      '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0node_modules\\@alune\\agent\\bin\\alune-agent.cjs" %*\r\n',
    );
  else
    fs.writeFileSync(
      path.join(output, 'alune-agent'),
      '#!/bin/sh\nalune_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec "$alune_root/runtime/bin/node" "$alune_root/node_modules/@alune/agent/bin/alune-agent.cjs" "$@"\n',
      { mode: 0o755 },
    );
  const entry = path.join(output, 'node_modules/@alune/agent/bin/alune-agent.cjs');
  const diagnostic = JSON.parse(
    execFileSync(nodePath, [entry, 'doctor'], {
      cwd: output,
      encoding: 'utf8',
      timeout: 15000,
      env: { ...process.env, NODE_PATH: '', ELECTRON_RUN_AS_NODE: '' },
    }),
  );
  if (!diagnostic.ok || diagnostic.node !== `v${runtimeVersion}`)
    throw new Error('Packaged runtime/native smoke failed');
  const isolated = createRequire(entry);
  for (const forbidden of ['electron', 'server', 'web']) {
    let found = false;
    try {
      isolated.resolve(forbidden);
      found = true;
    } catch {}
    if (found) throw new Error(`Isolated package can still resolve ${forbidden}`);
  }
  const files = Object.fromEntries(
    allFiles(output)
      .sort()
      .map((file) => [
        path.relative(output, file).split(path.sep).join('/'),
        digest(fs.readFileSync(file)),
      ]),
  );
  const sourceStatus = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
  }).trim();
  if (sourceStatus) process.stderr.write(`Agent package source is dirty:\n${sourceStatus}\n`);
  const manifest = {
    schemaVersion: 1,
    target,
    version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version,
    sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    dirty: Boolean(sourceStatus),
    node: {
      version: runtimeVersion,
      archive: baseURL + archiveName,
      sha256: expected,
      executable: nodeRelative,
    },
    diagnostic,
    packages: Object.fromEntries(packages),
    files,
  };
  fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(
    JSON.stringify({ output, target, diagnostic, packageCount: packages.size }) + '\n',
  );
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
