const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { privateDirectory, verifyPrivateSourceKey } = require('../dist/adapters/private-files');
test(
  'source key permission checks never repair or replace unsafe legacy keys',
  { timeout: 60000 },
  async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alune-source-key-policy-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    await privateDirectory(root);
    const file = path.join(root, 'ai-master-key'),
      bytes = Buffer.alloc(32, 7);
    fs.writeFileSync(file, bytes, { mode: 0o600 });
    await verifyPrivateSourceKey(file);
    let before, readAcl;
    if (process.platform === 'win32') {
      const executable = path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      const invoke = (script) =>
        execFileSync(
          executable,
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64'),
          ],
          { env: { ...process.env, ALUNE_FIXTURE_KEY: file }, encoding: 'utf8', timeout: 15000 },
        );
      invoke(
        `$acl=[System.IO.File]::GetAccessControl($env:ALUNE_FIXTURE_KEY);$everyone=[System.Security.Principal.SecurityIdentifier]::new('S-1-1-0');$rule=[System.Security.AccessControl.FileSystemAccessRule]::new($everyone,[System.Security.AccessControl.FileSystemRights]::Read,[System.Security.AccessControl.AccessControlType]::Allow);$acl.AddAccessRule($rule);[System.IO.File]::SetAccessControl($env:ALUNE_FIXTURE_KEY,$acl)`,
      );
      readAcl = () =>
        invoke(
          `[Console]::Out.Write([System.IO.File]::GetAccessControl($env:ALUNE_FIXTURE_KEY).GetSecurityDescriptorSddlForm([System.Security.AccessControl.AccessControlSections]::Access))`,
        );
      before = readAcl();
    } else {
      fs.chmodSync(file, 0o644);
      before = fs.statSync(file).mode;
    }
    await assert.rejects(verifyPrivateSourceKey(file), (e) => e.kind === 'permission');
    assert.deepEqual(fs.readFileSync(file), bytes);
    assert.equal(readAcl ? readAcl() : fs.statSync(file).mode, before);
    await assert.rejects(
      verifyPrivateSourceKey(file, AbortSignal.abort()),
      (e) => e.name === 'AbortError',
    );
  },
);
