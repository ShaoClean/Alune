export const batch = 'docs/acceptance/issue-257-258/batch-29-proxy-controller-20261116';
export const prior =
  'docs/acceptance/issue-257-258/batch-28-proxy-git-contracts-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-proxy-controller.test.cjs';
export const implementation = [
  'packages/agent/src/bootstrap/proxy-test.ts',
  'packages/agent/src/bootstrap/settings-kernel.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/bootstrap/hosts.ts',
  'packages/agent/src/modules/hosts/snapshot.ts',
  'packages/agent/src/modules/repositories/catalog.ts',
  'packages/agent/src/adapters/network/runtime.ts',
];
export const expectedChanges = ['packages/agent/src/bootstrap/proxy-test.ts'];
export const names = {
  inventory:
    'P0 proxy controller entire frozen source decorators and four delegations preserve exact arguments and errors',
  http: 'P0 proxy controller HTTP full validation response cleanup revision fencing and safe failure categories execute',
  errors:
    'P0 proxy controller SSH cancellation deadline error causes and all listener cleanup branches execute',
  git: 'P0 proxy controller Git every ownership forwarding remote URL and task release responsibility executes',
  routing:
    'P0 proxy controller successor validates kind without coercion routes owner resources and fences revisions',
  cancellation:
    'P0 proxy controller successor cancellation session closure malformed URLs and raw errors cannot report success or leak',
  snapshot:
    'P0 proxy controller successor remote Git snapshot validates all URLs before readonly probes and closes every transport',
  hosts:
    'P0 proxy controller successor actual hosts kernel enforces revision session forwarding pins and busy reconnect policy',
  kernels:
    'P0 proxy controller successor real settings and host status handlers preserve owner isolation events and restart',
  realHTTP:
    'P0 proxy controller real HTTP query uses saved proxy HEAD refuses redirects auth failures and closes on cancellation',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped migrated-responsibility acceptance only; releaseEligible=false. Entire exact frozen proxy.controller.ts executes with recording Nest decorators and settings/connections/repositories/GitCommands ports; no running Nest HTTP server or ParseUUIDPipe execution claim. All five controller methods, imports, class metadata, pre/post revision checks, HTTP HEAD validation/body cleanup/status/errors, SSH authentication dispatch, Git ownership/current revision/hold/prepare/deduplicated 1..20 URLs/read-only argv/limit/release and request-close cancellation are covered. Frozen zero-effective-URL success gap is documented; successor rejects zero or invalid full URL sets before executing any probe. Current production handler, snapshot and built hosts.js execute: owner-local alias to remote ResourceRef, pinned SSH authentication, session/revision/forwarding gates, busy task/terminal explicit reconnect, status projection, cancellation and restart. hosts.js uses recording connectHost/probeAuthentication/HostRelay ports for route policy, not live installed remote Agent negotiation. Same-run real SQLite kernels, actual HTTP CONNECT HEAD/redirect/403/407/session cancellation, Git HTTP/OpenSSH/ssh2 loopback companions and SDK/stdio settings/unknown-write receipts are independent evidence; not arbitrary external SSH host or installation proof. Successor generic unexpected error messages and failed query cancellation are explicit migration policy, not byte-identical legacy wording. Query result/bridge ports are not durable mutation receipts; unknown writes must not replay, cancellation does not imply rollback. Only original full controller source/class 0467/0468 credited; previous helper/method/UI IDs are not re-credited. UI 1943/1944 still require real client interactions. Independent retirement gate still fails because apps/server exists; no complete P0, current Mac install/upgrade/native update/rollback, actual full migration backup/recovery, SSH performance or final release claim. Hosted-only restrictions unchanged.';
export const modules = [
  {
    scenarioId: 'P0-PROXY-0467',
    tests: Object.values(names),
    assertion:
      'Whole exact frozen source inventory and execution of constructor/settings/save/statuses/reconnect/test; all HTTP/SSH/Git, revision/error/cancellation/finally branches. Successor production RPC routing, settings/status/reconnect policy, full Git snapshot probes, resource ownership and session identity, actual loopback HTTP/SSH/Git companions and SDK durable receipt boundaries. Explicitly retires Nest/global ID surface for owner-local resource routes; recording ports are not live remote installation evidence.',
  },
  {
    scenarioId: 'P0-PROXY-0468',
    tests: Object.values(names),
    assertion:
      'Complete decorated ProxyController class methods and constructor dependency binding; exact delegation identity and arguments, full test lifecycle and finally cleanup. Current strict kind validator rejects coercion arrays, pre-cancelled request/session performs zero network/catalog work, in-flight session close prevents success; revision fencing, remote binding, host pin, busy/denied forwarding and readonly remote URL matrix execute from built production modules. Query and durable mutation semantics remain separate.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/git-local-git-proxy.test.cjs',
  'packages/agent/tests/git-local-git-partial-proxy.test.cjs',
  'packages/agent/tests/git-proxy-transport.test.cjs',
  'packages/agent/tests/settings-rpc.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
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
