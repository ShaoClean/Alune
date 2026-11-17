// Exact reviewed runtime assertions for the remaining frozen identities.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { validateLedger, validateBindings } from './p0-test-receipts.mjs';
const root = fileURLToPath(new URL("../../../", import.meta.url));
const sha = '8f30e6bcc0a4b7706c192896a73b87dc1a915ed9';
export function aiWebPlan(ledger, progress, group) {
  validateLedger(ledger);
  if (progress.currentSha !== sha) throw Error('Unexpected reviewed progress SHA');
  if (!['ai', 'web', 'reviews'].includes(group)) throw Error('Unknown assertion group');
  const remaining = new Set(progress.rows.filter(r => r.status === 'needs-explicit-assertion').map(r => r.id));
  const testFile = group === 'ai' ? 'packages/agent/tests/p0-ai-service-migration.test.cjs' : group === 'reviews' ? 'packages/agent/tests/p0-review-service-migration.test.cjs' : 'apps/web/tests/p0-export-boundaries.test.mjs';
  const lines = fs.readFileSync(path.join(root, testFile), 'utf8').split('\n');
  const bindings = [];
  const ref = prefix => {
    const found = lines.flatMap((line, index) => line.startsWith("test('") && line.slice(6).startsWith(prefix) ? [{ name: line.slice(6, line.indexOf("',")), line: index + 1, file: testFile }] : []);
    if (found.length !== 1) throw Error('Missing exact assertion: ' + prefix);
    return found[0];
  };
  const add = (file, exports, methods, source, tests, assertion, implementation = [file]) => {
    const entries = [...exports.map(name => `export:${file}:${name}`), ...methods.map(name => `method:${file}:${name}`), ...(source ? [`source:${file}:${file}`] : [])];
    if (entries.some(id => !remaining.has(id))) throw Error('Binding is not a reviewed unasserted ID: ' + entries.filter(id => !remaining.has(id)).join(', '));
    bindings.push({ entries, implementation, tests: tests.map(ref), assertion,
      limitations: 'Scoped direct value/state/error assertions only. Frozen AI source executes with controlled ports; web tests execute current functions, stores and server rendering with explicit frozen-value oracles. Source IDs associate only the stated responsibility. No UI callback/browser, remote provider, installed upgrade, full branch/module or feature completeness claim.' });
  };
  if (group === 'ai') {
    add('apps/server/src/ai/ai-provider.ts', ['complete', 'fetchModels'], [], true, ['P0 AI providers preserve', 'P0 AI model pagination'],
      'All three provider protocols produce identical exact requests and literal content. Authentication, non-JSON, oversized, empty/truncated responses refuse without secret disclosure; pagination filters/deduplicates and refuses incomplete cursors.',
      ['packages/agent/src/adapters/providers/ai-provider.ts', 'packages/agent/src/ports/provider-error.ts', 'packages/agent/src/ports/provider-http.ts']);
    add('apps/server/src/ai/ai.service.ts', ['AiService'], ['onModuleDestroy', 'run', 'models', 'test', 'generatePullRequest', 'generate'].map(n => 'AiService.' + n), true,
      ['P0 AI service model merge', 'P0 AI service PR generation', 'P0 AI service shutdown'],
      'Frozen and current services preserve enabled model selection, exact model merging, request/prompt provenance, staged/config/branch revision refusal, release on failures, abort propagation, active-controller cleanup and draft-preserving errors.',
      ['packages/agent/src/modules/ai/service.ts', 'packages/agent/src/modules/ai/pull-request-prompt.ts', 'packages/agent/src/adapters/providers/ai-provider.ts', 'packages/agent/src/ports/provider-error.ts']);
  } else if (group === 'reviews') {
    const requestFile = 'apps/server/src/repository/pull-requests.service.ts';
    const requestInput = ['packages/agent/src/modules/reviews/pull-requests.service.ts', 'packages/agent/src/modules/reviews/pull-request-remote.ts', 'packages/agent/src/ports/provider-error.ts'];
    add(requestFile, ['normalizeItem'], ['withDeadline', 'readRemotes', 'target'].map(n => 'PullRequestsService.' + n), false,
      ['P0 PR normalization and remote targeting'], 'Direct frozen/current normalization and remote targeting preserve trusted URLs, exact remote identity, selection revision refusal and secret-free errors.', requestInput);
    add(requestFile, ['PullRequestsService'], ['withRequest'].map(n => 'PullRequestsService.' + n), false,
      ['P0 PR request wrapper'], 'Direct frozen/current HTTP wrappers assert exact saved/temporary anonymous credentials, trusted request headers and redirects; anonymous writes fail before dispatch. Fetch is a controlled in-memory response port.', requestInput);
    add(requestFile, [], ['centerPage', 'checkedFiles', 'projectUrl', 'assertDetail'].map(n => 'PullRequestsService.' + n), false,
      ['P0 PR detail checks bracket'], 'Direct file reads check revisions before and after; stale state prevents reading; identity cache preserves account but never replaces detail revision checks, exact project URL encoding and PR identity refusal.', requestInput);
    add('apps/server/src/repository/pull-request-creation.service.ts', ['PullRequestCreationService'], ['template', 'options'].map(n => 'PullRequestCreationService.' + n), false,
      ['P0 PR creation templates'], 'Direct frozen/current template methods verify sorted safe discovery, exact branch query and 12000-character bound; member/label options retain literal values and permission/partial-result notices.',
      ['packages/agent/src/modules/reviews/pull-request-creation.service.ts', ...requestInput]);
    add('apps/server/src/repository/pull-request-center.service.ts', ['PullRequestCenterService'], ['withSlot', 'context', 'prune', 'advance'].map(n => 'PullRequestCenterService.' + n), false,
      ['P0 PR center slots', 'P0 PR center merge'], 'Frozen/current center slots enforce four concurrent calls, release queued work and failures, project context exactly and prune bounded snapshots. Merge waits for all five source heads across bounded waves before emitting, preserving order and deduplicating exact project identities.',
      ['packages/agent/src/modules/reviews/pull-request-center.service.ts', 'packages/agent/src/ports/provider-error.ts']);
  } else {
    const web = 'apps/web/src/';
    const addWeb = (file, names, source, tests, assertion) => add(web + file, names, [], source, tests, assertion);
    addWeb('components/ui.tsx', ['formatRelativeDate', 'formatBranchName'], true, ['P0 date and branch formatting'], 'Exact missing/invalid and minute/hour/day/week thresholds with a controlled clock; branch prefix stripping preserves literal other text.');
    addWeb('components/CommitSignatureBadge.tsx', ['CommitSignatureBadge'], true, ['P0 signature badges'], 'Every signature trust state/reason, pending/error/detail mode and signer/key escaping are asserted from rendered output.');
    addWeb('components/PullRequestPresentation.tsx', ['PullRequestStatus', 'PullRequestBranches'], true, ['P0 PR presentation'], 'Every PR state label/class, deleted/unknown branches and escaped literal refs are asserted from rendered output.');
    addWeb('components/PullRequestsView.tsx', ['defaultPullRequestRemote'], false, ['P0 PR remote defaults'], 'Exact remote precedence chooses usable origin, recognized provider, other usable remote, first unavailable fallback or empty.');
    addWeb('components/PullRequestDetails.tsx', ['mergeDiscussions'], false, ['P0 PR remote defaults'], 'Thread identity/order, latest duplicate comment replacement, latest thread metadata and input immutability are asserted.');
    addWeb('stores/pullRequestCenter.ts', ['defaultCenterQuery', 'centerListUrl'], false, ['P0 PR remote defaults'], 'Exact default query and canonical sorted project/search URL encoding are asserted.');
    addWeb('stores/aiSettingsStore.ts', ['defaultCommitModel', 'useAiSettingsStore'], true, ['P0 AI settings accept'], 'Enabled saved model/provider identity is required; accept invalidates a pending load and failed reload retains saved settings while clearing loading.');
    addWeb('stores/terminalRemoval.ts', ['registerTerminalRemovalConfirmation', 'confirmTerminalRemoval'], true, ['P0 terminal removal defaults'], 'Unregistered/cancelled removal refuses, exact sessions reach the callback, acceptance propagates and callback errors remain errors.');
    addWeb('api/logging.ts', ['logBridge', 'openLogViewer'], false, ['P0 log viewer dispatch'], 'No-window bridge is absent, browser opens the reusable named logs tab and desktop uses the actual injected bridge exactly once.');
    addWeb('logging/clientErrors.ts', ['installClientErrorReporting'], true, ['P0 log viewer dispatch'], 'Both renderer listeners report ERROR/page/file/line, repeated error deduplicates, reporting failures do not recurse and disposal removes both exact listeners.');
    addWeb('hooks/useRepositoryWorkspace.ts', ['workspaceListId', 'RepositoryWorkspaceContext', 'useRepositoryWorkspace', 'useWorkspaceLocation'], true, ['P0 workspace context keeps'], 'Repository list identity is exact; absent context uses router location and a hidden workspace retains its own repository/location through actual React context consumers.');
    addWeb('components/BrandIcon.tsx', ['BrandIcon'], true, ['P0 brand and diff glyphs'], 'Brand dimensions, decorative accessibility, drag refusal, default/overridden class and two distinct SVG view glyphs are asserted.');
    addWeb('components/DiffViewIcons.tsx', ['UnifiedViewIcon', 'SplitViewIcon'], true, ['P0 brand and diff glyphs'], 'Both actual exports render distinct SVG glyphs; no view-toggle callback or browser layout claim.');
  }
  const plan = { schemaVersion: 1, sha, ...(group === 'web' ? { nodeImports: ['apps/web/tests/resolve-ts.mjs'] } : {}),
    reviewedTooling: { [testFile]: createHash('sha256').update(fs.readFileSync(path.join(root, testFile))).digest('hex') }, bindings };
  validateBindings(ledger, plan);
  return plan;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [ledger, progress, group, output] = process.argv.slice(2);
  if (!output) throw Error('Usage: p0-ai-web-plan.mjs LEDGER PROGRESS ai|web|reviews NEW_PLAN');
  const plan = aiWebPlan(JSON.parse(fs.readFileSync(ledger)), JSON.parse(fs.readFileSync(progress)), group);
  fs.writeFileSync(output, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ group, bindings: plan.bindings.length, ids: plan.bindings.flatMap(r => r.entries).length }));
}
