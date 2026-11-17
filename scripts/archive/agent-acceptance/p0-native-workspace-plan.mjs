export const batch = 'docs/acceptance/issue-257-258/batch-12-native-workspace-20261113';
export const prior =
  'docs/acceptance/issue-257-258/batch-11-native-log-boundaries-20261113/replay-02';
export const testFile = 'packages/agent/tests/p0-native-workspace.test.cjs';
export const implementation = [
  'apps/desktop/src/main.cjs',
  'apps/desktop/src/workspace-preferences.cjs',
  'apps/desktop/src/preload.cjs',
];
export const names = {
  chooser:
    'P0-BOOTSTRAP-0009 frozen and current workspace chooser preserves exact query results and trust',
  operations:
    'P0-BOOTSTRAP-0010 exact workspace operations preserve bytes validation and read failure semantics',
  sync: 'P0-BOOTSTRAP-0011 exact synchronous saves always acknowledge errors and preload throws safely',
  isolation:
    'P0 workspace native identity denies cross-window stale frame foreign and malformed origins',
  kill: 'P0 workspace completed synchronous reply survives immediate process kill without replay',
};
export const limitations =
  'Local darwin-arm64 working-tree scoped native-channel assertions only; releaseEligible=false. Whole frozen/current workspace-preferences and preload execute; precisely selected start-owned chooser, operation loop and synchronous listener execute from main.cjs, with source/line/hash retained. Entire main startup and installed Electron UI are not tested. Electron dialog/IPC and window frames are explicit doubles; real isolated files and child SIGKILL exercise acknowledgement-before-disk-read semantics, not power-loss fsync durability. Workspace preferences intentionally remain local desktop UI state, not Agent/remote storage. Cross-window identity is tested, not SSH transport; chosen repository path is only a native query result, not a repository registration or Agent resource. Dialog cancellation/errors are preserved without preference writes. Native sync save acknowledges once; unknown business mutation replay is separately required via exact task-journal anchors, not claimed as native RPC behavior. Frozen malformed JSON exposed its SyntaxError message; current preexisting validation wraps it as Invalid workspace preferences. Both reject without altering bytes; this intentional normalization is separately asserted. No production fix was necessary. User data/OS credentials untouched. Full P0, whole desktop entry, real picker/install/upgrade/update/rollback/migration backup/recovery/SSH/performance/final release gates remain independent; hosted-only unchanged.';
export const modules = [
  {
    scenarioId: 'P0-BOOTSTRAP-0009',
    tests: [names.chooser, names.isolation],
    assertion:
      'Exact frozen/current chooser registration and whole preload retain fixed parent/title/button/openDirectory options, no renderer arguments, first path/null/empty/cancel/exception/delayed cancellation results; selection does not write preferences or register repositories. Only exact active workspace main frame and origin allowed; foreign/absent/stale/cross-window denied.',
  },
  {
    scenarioId: 'P0-BOOTSTRAP-0010',
    tests: [names.operations, names.isolation, names.kill],
    assertion:
      'Execute exact frozen/current load/save/clear loop, real isolated file and whole preload: missing/malformed/version reads, exact string bytes, private atomic file, invalid writes preserve prior bytes, temporary write failure publishes nothing, repeated clear and non-ENOENT IO errors. Other window/stale/foreign frames cannot load, save or clear. Desktop-only UI preferences do not become remote Agent resources.',
  },
  {
    scenarioId: 'P0-BOOTSTRAP-0011',
    tests: [names.sync, names.isolation, names.kill],
    assertion:
      'Exact frozen/current sync listener and complete preload: successful null acknowledgement and undefined async bridge result after synchronous save, invalid/access/IO/non-Error failures always return safe string and bridge rejection. Actual child executes same listener/module, acknowledges then receives SIGKILL; complete saved bytes recover without replay. This proves process-kill boundary, not power-loss durability.',
  },
];
export const testFiles = [
  testFile,
  'apps/desktop/test/p0-preload.test.cjs',
  'apps/desktop/test/workspace-preferences.test.cjs',
  'apps/desktop/test/agent-window-channel.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'trusted workspace sender requires the exact main frame and origin',
  'same-frame navigation invalidates a pending open before the replacement document opens',
  'late frames/end from a retired channel never reach or close the replacement document',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
];
