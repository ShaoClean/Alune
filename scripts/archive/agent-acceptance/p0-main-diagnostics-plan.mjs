import {
  implementation as earlierImplementation,
  lifecycleTests as earlierTests,
  modules as earlierModules,
} from './p0-startup-lifecycle-plan.mjs';
import { lifecycleTests as bootstrapTests } from './p0-bootstrap-session-plan.mjs';
export const batch = 'docs/acceptance/issue-257-258/batch-09-main-diagnostics-20261113';
export const prior = 'docs/acceptance/issue-257-258/batch-08-startup-lifecycle-20261113/replay-03';
export const testFile = 'packages/agent/tests/p0-main-diagnostics.test.cjs';
export const fixtureFile = 'packages/agent/tests/main-diagnostics-fixture.cjs';
export const lifecycleTestFile = 'packages/agent/tests/p0-startup-lifecycle.test.cjs';
export const bootstrapTestFile = 'packages/agent/tests/p0-bootstrap-session.test.cjs';
export const companionTestFile = 'packages/agent/tests/p0-startup-options.test.cjs';
export const devTestFile = 'apps/web/tests/integration/p0-startup-auth.test.mjs';
export const secretTestFile = 'packages/agent/tests/p0-module-secrets.test.cjs';
export const modules = [
  {
    scenarioId: 'P0-BOOTSTRAP-0460',
    name: 'P0-BOOTSTRAP-0460 complete frozen entry has explicit diagnostics and lifecycle successors',
    assertion:
      'Entire frozen main.ts executes with explicit bootstrap/logger doubles: default monitor and origin/context, startServer, Nest shutdown hooks, printed URL. Complete successor desktop main executes with Electron/update doubles and real isolated Agent/native/logs sessions: early synchronous stderr, default fatal process exit before/after ready, failed stderr safety, nonfatal rejection policy, persistent ready diagnostics after Agent restart, logger refusal. Real child early rejection and crash tests; same-run prior startup/auth/security/lifecycle and CLI EOF/signals assertions are all required. Old public HTTP/URL stdout/Nest hooks are intentionally replaced, desktop established nonfatal rejection policy is now consistent before ready. No complete main.cjs/0008 pass.',
  },
];
export const unresolved = [];
export const implementation = ['apps/desktop/src/main.cjs', ...earlierImplementation];
export const limitations =
  'Working-tree local darwin-arm64 scoped successor acceptance only; releaseEligible=false. Entire frozen main executes in restricted VM with explicit logger/startServer doubles; old live Nest server is not started. Entire desktop main runs with explicit Electron/update doubles, real independent Agent/SQLite/native/logs sessions, loopback HTTP/IPC and isolated files. Fatal crash and early Promise rejection use real Node child processes with explicit Electron/Agent doubles. Fatal logs guarantee a synchronous fd2 attempt, not delivery to Agent disk before process death; ready nonfatal logs are verified persisted. Desktop nonfatal rejection policy replaces old server default crash, and now applies before ready. No default runtime uncaughtException handler installed. New stderr errors, like Node default crash output, are local process diagnostics rather than redacted exported log guarantees. Actual Electron header injection, complete main.cjs/0008 UI/menu/update/terminal lifecycle, OS credentials/migration, SSH/install/update/rollback/performance and complete release gates remain independent. Hosted-only security policy unchanged.';
export const lifecycleTests = [
  'P0 diagnostics early fatal exception retains the default nonzero process exit',
  'P0 diagnostics early rejection is visible before Agent readiness',
  'P0 diagnostics whole main forwards ready errors to isolated Agent logs and survives logger refusal',
  ...earlierModules.map((m) => m.name),
  ...earlierTests,
  ...bootstrapTests,
];
