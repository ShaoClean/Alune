export const batch = 'docs/acceptance/issue-257-258/batch-11-native-log-boundaries-20261113';
export const prior = 'docs/acceptance/issue-257-258/batch-10-logging-boundaries-20261113/replay-03';
export const testFile = 'packages/agent/tests/p0-native-log-boundaries.test.cjs';
export const implementation = [
  'apps/desktop/src/log-window.cjs',
  'apps/desktop/src/main.cjs',
  'apps/desktop/src/preload.cjs',
  'apps/desktop/src/workspace-preferences.cjs',
  'apps/desktop/src/external-links.cjs',
  'apps/desktop/src/agent-window-channel.cjs',
  'apps/desktop/src/desktop-agent.cjs',
  'packages/agent/src/bootstrap/ui.ts',
  'packages/agent/src/modules/diagnostics/logs.ts',
];
export const names = {
  malformed: 'P0 native log window rejects malformed navigation without throwing',
  window:
    'P0-DIAGNOSTICS-0005 frozen and current whole log window preserve isolated lifecycle and security options',
  open: 'P0-BOOTSTRAP-0012 exact native open-window handlers reject foreign frames and preserve preload results',
  directory:
    'P0-BOOTSTRAP-0013 exact open-directory handlers retain results errors and local directory authority',
  chooser:
    'P0-BOOTSTRAP-0014 exact directory chooser accepts only workspace and never saves selected paths',
  actual: 'P0 native log channels use real local Agent settings and isolate cross-host senders',
};
export const limitations =
  'Local darwin-arm64 working-tree scoped successor assertions only; releaseEligible=false. Whole frozen/current log-window, preload, external-links and workspace-preferences execute in restricted VMs. The three exact main.cjs IPC registrations, trustedLogSender and openLogDirectory are selected by AST with start() ownership checked and source hashes/text retained; entire main startup is not executed by these tests. Electron BrowserWindow/dialog/shell are explicit doubles; no real OS picker, Finder or installed Electron window/UI is claimed. Old in-process settings accessor is an explicit directory double; current path uses real isolated desktop-agent/HTTP/IPC/UI Agent/SDK/SQLite and log files with synthetic data, migration and safeStorage doubles. Added --alune-agent-ui preload capability, Agent-owned logs and role restrictions intentionally replace old Nest ownership; current native role only reads settings, workspace role writes, logs role snapshots only. Invalid navigation now fails closed rather than throwing. Directory selection/cancel is a native query, never a settings write; unknown mutation replay behavior is independently rebound. No user data/OS credentials used. Full source/feature/branch, original HTTP/Nest logging, log viewer UI, install/update/rollback/actual migration backup/recovery/SSH/performance/full P0/final release gates remain independent; hosted-only requirements unchanged.';
export const modules = [
  {
    scenarioId: 'P0-DIAGNOSTICS-0005',
    tests: [names.window, names.malformed, names.open, names.actual],
    assertion:
      'Whole frozen/current log-window executes missing-origin, singleton/restoration/show/hide, close/destroy/replacement/stale-close, load-refusal, exact sandbox/partition/preload options, same-origin navigation, foreign navigation/webview blocking and external-link handling. Current malformed URL navigation/redirect is fixed to prevent without exception. New Agent preload switch is explicit; actual Agent log sessions and native channels exercised with Electron doubles, not real rendered UI.',
  },
  {
    scenarioId: 'P0-BOOTSTRAP-0012',
    tests: [names.open, names.window, names.actual],
    assertion:
      'Exact frozen/current start-owned logs:open-window registration and trust predicate execute through whole preload: no renderer arguments forwarded, undefined reply preserved, trusted workspace/current log main frames reuse/create viewer; outsider, child, malformed/foreign-origin, closed/replaced log contents and cross-Agent window identities denied with no effects. Real Agent role isolation remains intact. Native query has no durable task or automatic replay.',
  },
  {
    scenarioId: 'P0-BOOTSTRAP-0013',
    tests: [names.directory, names.actual],
    assertion:
      'Exact frozen/current logs:open-directory and helper execute result/smoke bypass, string OS failure with warning and rejected shell/Agent read; caller path ignored, trusted workspace/log frames only. Current real native Agent supplies local configured directory, cross-Agent sender/revision denied, closed backend refuses before shell, selected logging directory persists through restart. Old in-process accessor is explicitly doubled; native OS openPath is doubled; no mutation or unknown task replay is created.',
  },
  {
    scenarioId: 'P0-BOOTSTRAP-0014',
    tests: [names.chooser, names.actual],
    assertion:
      'Exact frozen/current logs:choose-directory registration runs fixed title/properties/main parent and workspace-only guard; canceled, empty list/path, first selected path, rejection and delayed cancel results checked. Whole preload drops supplied args. Real Agent logging settings and filesystem remain unchanged after candidate-only selection/cancel; log/foreign/subframe/cross-Agent senders denied. Picking a path does not save it or synthesize a durable settings mutation.',
  },
];
export const testFiles = [
  testFile,
  'apps/desktop/test/p0-preload.test.cjs',
  'apps/desktop/test/workspace-preferences.test.cjs',
  'apps/desktop/test/agent-window-channel.test.cjs',
  'apps/desktop/test/clipboard-permissions.test.cjs',
  'apps/desktop/test/external-links.test.cjs',
  'packages/agent/tests/diagnostics.test.cjs',
  'packages/agent/tests/task-journal.test.cjs',
  'packages/agent/tests/events.test.cjs',
  'packages/agent/tests/protocol-compat.test.cjs',
  'packages/agent-client/tests/stdio.test.cjs',
  'scripts/archive/agent-acceptance/p0-test-receipts.test.mjs',
];
export const requiredCompanionNames = [
  'trusted workspace sender requires the exact main frame and origin',
  'same-frame navigation invalidates a pending open before the replacement document opens',
  'late frames/end from a retired channel never reach or close the replacement document',
  'logging settings use durable revisions and reject stale or invalid saves',
  'immutable log snapshots cross UTF-8 chunk boundaries, redact ciphertext and publish bounded invalidations',
  'renderer log flood is rate limited and stale snapshot handles fail explicitly',
  'corrupt logging configuration stays intact and valid replacement is refused until recovery',
  'mutation receipts survive process restart without storing parameters or operation results',
  'crashed mutations become unknown and an identical request is never executed again',
];
