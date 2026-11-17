export const batch = 'docs/acceptance/issue-257-258/batch-28-proxy-git-contracts-20261116';
export const prior =
  'docs/acceptance/issue-257-258/batch-27-proxy-settings-source-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-proxy-git-contracts.test.cjs';
export const implementation = [
  'packages/agent/src/adapters/ssh/proxy-git.ts',
  'packages/agent/src/adapters/git/local-git-proxy.ts',
  'packages/agent/src/adapters/git/native.ts',
  'packages/agent/src/adapters/network/proxy-transport.ts',
  'packages/agent/src/modules/git/git-shell.ts',
];
export const names = {
  inventory:
    'P0 proxy Git full source inventory and shared error identity retain explicit safe contracts',
  arguments:
    'P0 proxy Git exact commands preserve quoted argv environment cancellation and fail closed on config reads',
  tools:
    'P0 proxy Git every tool selection branch retains ordered flags and explicit missing tool failure',
  tunnel:
    'P0 proxy Git real Python CONNECT helper relays binary data brackets IPv6 and rejects refused damaged headers',
  snapshot:
    'P0 proxy snapshot exact frozen type and production declaration accept valid shapes and reject invalid fields',
  errors:
    'P0 proxy transport all typed failures retain safe messages prototype and real failure classification',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped migrated-responsibility acceptance only; releaseEligible=false. Full exact frozen proxy-git.ts executes with exact frozen git-shell.ts; recording SSHConnection port is explicitly a double, not live remote command execution. Command output is executed against a recording Git executable to assert argv/env/quoting; all nc/ncat/connect/socat/python selection branches use recording tool doubles. Real installed Python executes HTTP CONNECT success/binary echo/IPv6 authority and bad/closed/oversized header cases over disposable loopback only. Current SSH adapter retains builder; current owner-local Agent replaces remote reverse forwarding with local runtime helper and fixed protocol allowlist, verified by actual Git/OpenSSH/ssh2 loopback companion tests with ephemeral host key. Snapshot is an internal runtime-only plaintext credential type; compile-time shape does not enforce secrecy, ownership, immutability or validation. Settings RPC companion separately establishes encrypted storage/redacted responses/no public snapshot method. ProxyTransportError typed union is validated by compiler and all four safe runtime messages; runtime arbitrary codes outside its type are not newly claimed validated. Actual HTTP/SOCKS/auth/TLS/refusal and cancellation checked by companion fixtures; timeout mapping uses controlled abort, not 20 seconds of wall time. No real external SSH host, Windows execution, remote installation, native updater/install/rollback, actual complete migration backup/recovery, performance or final release claim. Unknown mutations are not replayed per separate task-journal companion; network result/bridge port is not durable receipt and cancellation does not imply rollback. Only exact original IDs 2629/2630/2635/2636 credited, not repeated helper/method/controller/UI IDs. UI 1943/1944 pending, independent apps/server retirement gate failed. Hosted-only restrictions unchanged.';
const errorContract =
  'Exact GitProxyError extends Error with inherited constructor/message/prototype/stack and no extra fields. Current SSH export and local Git export are the same class identity, preserving instanceof on rejected unreadable config; raw connection errors/cancellation propagate without automatic retry.';
export const modules = [
  {
    scenarioId: 'P0-PROXY-2629',
    tests: [names.inventory, names.arguments, names.tools, names.tunnel],
    assertion:
      'Complete source inventory: all three imports, error class, loopback predicate, Python script compressor, entire CONNECT script, tool selection and proxyGitArguments. Execute each responsibility with exact frozen shell dependency and current production dist: argv/env/signal/output limit, exit 0/1 success, other exits/rejections fail closed, overrides/protocol restrictions, every tool selection/missing tool, real binary helper and malformed CONNECT outcomes. Actual current Git HTTP/SSH and cancellation companions establish migrated owner-local runtime routing. Explicit recording ports/tools are not live remote SSH or every OS/tool implementation coverage.',
  },
  {
    scenarioId: 'P0-PROXY-2630',
    tests: [names.inventory, names.arguments],
    assertion: errorContract,
  },
  {
    scenarioId: 'P0-PROXY-2635',
    tests: [names.snapshot],
    assertion:
      'Entire frozen ProxySnapshot interface exact fields and ProxyProtocol dependency compile against valid disabled/http/https/socks5/optional credential shapes. Compiler rejects missing required fields, wrong primitives, unsupported protocol and partial credentials for frozen and actual current declarations; source members match exactly. Runtime-only secret-bearing type is deliberately not exported via public settings RPC; explicit RPC companion checks no snapshot method and no response/event credential leakage. Type shape alone does not guarantee secrecy or runtime immutability.',
  },
  {
    scenarioId: 'P0-PROXY-2636',
    tests: [names.errors, names.snapshot],
    assertion:
      'Whole frozen ProxyTransportError constructor, readonly code union, Error inheritance and four exact safe messages match current class; type checker rejects unsupported codes and code mutation. Recorded timeout/deadline and raw CERT/TLS/SSL/SELF_SIGNED/connect failures classify without leaking raw secret text; existing typed errors preserve identity. Actual production HTTP/SOCKS auth/TLS/refusal companion tests verify consumers fail closed. Arbitrary untyped code and wall-clock deadline are outside this scoped assertion.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/git-local-git-proxy.test.cjs',
  'packages/agent/tests/git-local-git-partial-proxy.test.cjs',
  'packages/agent/tests/git-proxy-transport.test.cjs',
  'packages/agent/tests/settings-rpc.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/agent/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'local HTTP Git overrides scoped proxy and NO_PROXY without persisting credentials or config',
  'repository protocol overrides cannot bypass the enabled app proxy',
  'cancelling a local Git transfer closes its proxy tunnel',
  'local SSH Git uses the application runtime for proxy tunnelling',
  'partial-clone lazy fetch never falls back to a directly reachable origin',
  'HTTPS proxies reject an untrusted certificate and closed proxies never fall back to direct',
  'SSH connects through the proxy; forwarding, busy tasks, and disconnect cleanup are distinct',
  'settings RPC persists revisions, encrypts credentials and exposes no credential read capability',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
];
