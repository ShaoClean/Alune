export const batch = 'docs/acceptance/issue-257-258/batch-30-file-module-20261116';
export const prior = 'docs/acceptance/issue-257-258/batch-29-proxy-controller-20261116/replay-01';
export const testFile = 'packages/agent/tests/p0-file-module.test.cjs';
export const implementation = [
  'packages/protocol/src/file-access.ts',
  'packages/agent/src/modules/files/access.ts',
  'packages/agent/src/bootstrap/state-kernel.ts',
  'packages/agent/src/server/session.ts',
  'packages/agent/src/adapters/files/native.ts',
];
export const expectedChanges = ['packages/protocol/src/file-access.ts'];
export const names = {
  registration:
    'P0 file module exact frozen imports constructors decorators and complete registration execute',
  list: 'P0 file service frozen list maps every entry kind empty directories and exact connection failures',
  read: 'P0 file service frozen read preserves exact bytes values host path identity and error propagation',
  write:
    'P0 file service frozen write awaits transport completion returns success and never hides failures',
  controller:
    'P0 file controller whole frozen class delegates list read wrapper write and all errors exactly',
  kernel:
    'P0 file module real successor read list write preserve text with explicit grants CAS and index isolation',
  policy:
    'P0 file module successor owner session revocation traversal symlink hardlink and cancellation fail closed',
  limits: 'P0 file module successor exact byte limits UTF8 binary and invalid inputs are enforced',
  stdio:
    'P0 file module actual SDK stdio grants reject coerced access persist receipts and revoke across restart',
};
export const blockedScenarios = [];
export const limitations =
  'Local darwin-arm64 dirty working-tree scoped migrated-responsibility acceptance only; releaseEligible=false. Exact frozen FileController/FileModule/FileService sources execute with recording Nest decorators, connection/repository ports; no live Nest HTTP server or arbitrary remote SSH installation claim. Complete constructors, imports, registration, list/read/write delegation and failures are asserted. Real successor state kernel uses actual SQLite/temp files/Git index, bounded UTF-8 grants, session/agent ownership, revoke/disconnect, traversal/symlink/hardlink-write refusal, CAS and concurrent write serialization. Actual SDK/stdio confirms strict access enum without coercion, persisted completed task receipt, same Agent identity and no grant resurrection after process restart. Legacy unrestricted absolute connection paths retire in favor of explicit session directory grants; permissions are intentional migration differences, no unrestricted equivalence claim. Legacy SFTP permission longname becomes basename and special-file classification is stricter; current text contract rejects binary/invalid UTF-8 and >4MiB, supplies SHA256 version and requires CAS. Direct handler returns are not durable receipts. Companion journal/recording relay proves unknown mutation/no-replay and removal policy; does not inject an interrupted actual file write or imply rollback. Only seven original source/class/read entries 0207/0208/0215/0216/0217/0218/0220 credited; previously accepted list/write method and client-api IDs are not credited again. UI diagnostics 1943/1944 remain pending actual client operations. Independent retirement gate fails while apps/server exists; full P0/current Mac install/upgrade/native update/rollback/full actual migration backup/recovery/applicable SSH/performance/final release remain independent. Hosted-only protections unchanged.';
const successor = [names.kernel, names.policy, names.limits, names.stdio];
export const modules = [
  {
    scenarioId: 'P0-FILES-0207',
    tests: [names.registration, names.controller, ...successor],
    assertion:
      'Entire exact frozen FileController source imports, constructor and all list/read/write handlers execute; decorator query/body/HTTP route order and read content wrapper verified. Successor real files and stdio preserve text operations under explicit bounded grants and CAS, rejection paths and restart; route policy changes explicitly recorded.',
  },
  {
    scenarioId: 'P0-FILES-0208',
    tests: [names.registration, names.controller, ...successor],
    assertion:
      'Complete FileController class identity and injected FileService; each method asserts exact host/path/content arguments, list/write return identity, read wrapper and failures. Migration to authenticated resource owner/session grant executes with current production handlers and real stdio.',
  },
  {
    scenarioId: 'P0-FILES-0215',
    tests: [names.registration, names.kernel, names.stdio],
    assertion:
      'Whole frozen FileModule source and all five imports execute; exact imports [ConnectionModule, RepositoryModule], controllers [FileController], providers [FileService], empty class instantiation. Successor state kernel registers all six file grant/list/read/write handlers and actual stdio routes without restoring retired Nest service.',
  },
  {
    scenarioId: 'P0-FILES-0216',
    tests: [names.registration, names.kernel, names.stdio],
    assertion:
      'FileModule class and complete metadata preserve dependency class identities. Production openStateKernel and SDK stdio demonstrate active owner-local file registration, disposal/disconnect and restart isolation instead of a new public helper RPC.',
  },
  {
    scenarioId: 'P0-FILES-0217',
    tests: [names.registration, names.list, names.read, names.write, ...successor],
    assertion:
      'Whole frozen FileService source executes constructor, every list/read/write responsibility, special/empty listing mapping, exact content identity, awaited write completion and transport/connection errors. All current operations execute on real local filesystem with owner/session checks, text bounds, safe paths, index isolation and stale/concurrent write refusal.',
  },
  {
    scenarioId: 'P0-FILES-0218',
    tests: [names.registration, names.list, names.read, names.write, ...successor],
    assertion:
      'Complete FileService class binds both dependencies while never accessing unused repository service; connection failure causes zero file I/O, read preserves exact values and raw error identity, write waits and reports failure. Successor strict grant schema, native local files, session identity and real persisted receipt boundaries are asserted.',
  },
  {
    scenarioId: 'P0-FILES-0220',
    tests: [names.read, names.controller, ...successor],
    assertion:
      'Exact frozen FileService.readFile ensures requested connection once then delegates exact absolute path and return/error identity including empty/unicode/Buffer cases. Real successor read/list/write and SDK stdio validate bounded UTF8 content and version, missing/binary/invalid/oversize failure, denied traversal/other owner/session/revoked grants and pre-cancellation. Legacy unrestricted/binary pass-through is an explicit retired policy, not claimed equivalent.',
  },
];
export const testFiles = [
  testFile,
  'packages/agent/tests/file-access.test.cjs',
  'packages/agent/tests/native-files.test.cjs',
  'packages/agent/tests/relayed-file-write.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'explicit session grants preserve outside-repository text access and isolate authority',
  'replacing an authorized directory does not transfer its authority',
  'native file port bounds reads and closes cancelled reads before returning',
  'a relayed file write blocks host removal until its terminal reply, without replay',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
  'failed durable finalization is immediately reported as unknown instead of stale running state',
];
