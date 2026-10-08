// Real Nest endpoints + SQLite + SSH + Git. Only hosting HTTP responses are simulated.
const path = require('node:path');
const fs = require('node:fs');
const { createServer } = require('node:http');
const {
  createRepository,
} = require('../../../packages/ssh-client/tests/helpers/local-repository.cjs');
const { startSSHServer } = require('../../../packages/ssh-client/tests/helpers/ssh-server.cjs');
const { startServer } = require('../../server/dist/bootstrap');
const { ConnectionService } = require('../../server/dist/connection/connection.service');
const { RepositoryService } = require('../../server/dist/repository/repository.service');

async function startPullRequestsFixture({ webRoot = path.resolve(__dirname, '../dist') } = {}) {
  const fixture = createRepository();
  const empty = createRepository();
  fixture.git('remote', 'add', 'origin', 'https://github.com/fixture/alune.git');
  fixture.git('remote', 'add', 'upstream', 'ssh://git@gitlab.example.com:2222/team/sub/alune.git');
  fixture.git('remote', 'add', 'unsupported', '/workspace/local.git');
  fixture.git('remote', 'add', 'gitlab', 'https://gitlab.com/team/alune.git');
  const servedRoot = path.join(fixture.root, 'web');
  fs.cpSync(webRoot, servedRoot, { recursive: true });
  const remote = await startSSHServer();
  const previousDir = process.env.ALUNE_DATA_DIR;
  process.env.ALUNE_DATA_DIR = path.join(fixture.root, 'app-data');
  const originalFetch = globalThis.fetch;
  const control = {
    status: 200,
    writeStatus: 200,
    delay: 0,
    delayNumber: null,
    failPath: '',
    calls: [],
    states: {},
    notes: {},
    layoutStress: false,
  };
  const title = (fallback) =>
    control.layoutStress
      ? '在狭窄工作区审阅跨平台兼容性变更，保留评论草稿并清晰展示长标题、分支和文件路径'
      : fallback;
  const branch = (number) =>
    control.layoutStress
      ? `feature/${number}/preserve-review-context-and-drafts-across-narrow-workspace-panels`
      : `feature/${number}`;
  globalThis.fetch = async (input, options) => {
    const url = new URL(String(input));
    if (!['api.github.com', 'gitlab.example.com', 'gitlab.com'].includes(url.hostname))
      return originalFetch(input, options);
    const github = url.hostname === 'api.github.com';
    const token = options.headers[github ? 'Authorization' : 'PRIVATE-TOKEN'];
    const resource = url.pathname.match(
      /\/(?:pulls|issues|merge_requests)\/(\d+)(?:\/(files|diffs|changes|discussions|reviews|comments|notes|merge))?$/,
    );
    const number = resource ? Number(resource[1]) : null;
    const current = {
      status: !control.failPath || url.pathname.endsWith(control.failPath) ? control.status : 200,
      delay: !control.delayNumber || number === control.delayNumber ? control.delay : 0,
    };
    control.calls.push({
      host: url.host,
      path: url.pathname,
      page: url.searchParams.get('page'),
      state: url.searchParams.get('state'),
      authenticated: Boolean(token),
      method: options.method || 'GET',
      ...(options.body ? { body: JSON.parse(options.body) } : {}),
    });
    if (current.delay)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, current.delay);
        options.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(options.signal.reason);
          },
          { once: true },
        );
      });
    if (current.status !== 200) return new Response('{}', { status: current.status });
    if (!github && !token) return new Response('{}', { status: 401 });
    if (url.pathname.endsWith('/user'))
      return new Response(JSON.stringify({ login: 'alune-contributor', username: 'alune-contributor', id: 7 }));
    if (!resource && !url.pathname.endsWith('/pulls') && !url.pathname.endsWith('/merge_requests'))
      return new Response(
        JSON.stringify(
          github
            ? {
                permissions: { push: true },
                allow_merge_commit: true,
                allow_squash_merge: true,
                allow_rebase_merge: true,
              }
            : {
                permissions: { project_access: { access_level: 40 } },
                merge_method: 'merge',
                squash_option: 'default_off',
              },
        ),
      );
    const identity = `${url.host}:${number}`;
    if (options.method) {
      if (control.writeStatus !== 200) return new Response('{}', { status: control.writeStatus });
      const body = JSON.parse(options.body);
      if (url.pathname.endsWith('/merge')) {
        control.states[identity] = 'merged';
        return new Response(JSON.stringify(github ? { merged: true } : { state: 'merged' }));
      }
      if (body.state === 'closed' || body.state_event === 'close') {
        control.states[identity] = 'closed';
        return new Response(JSON.stringify({ state: 'closed' }));
      }
      const id = 1000 + control.calls.length;
      const note = {
        id,
        body: body.body,
        created_at: new Date().toISOString(),
        user: { login: 'alune-contributor' },
        author: { username: 'alune-contributor' },
        ...(github && body.path
          ? {
              path: body.path,
              side: body.side,
              line: body.line,
              start_line: body.start_line,
              start_side: body.start_side,
              diff_hunk:
                '@@ -10,2 +10,3 @@\n export function open() {\n-  return external();\n+  // Keep review context inside Alune.\n+  return details();',
            }
          : {}),
        ...(!github && body.position ? { position: body.position } : {}),
      };
      const kind = github ? (body.path ? 'code' : 'comments') : 'comments';
      const discussion = github ? note : { id: String(id), notes: [note] };
      (control.notes[`${identity}:${kind}`] ||= []).push(discussion);
      return new Response(JSON.stringify(!github && !body.position ? note : discussion));
    }
    if (resource) {
      const page = Number(url.searchParams.get('page') || 1);
      const kind = resource[2];
      const date = '2026-09-29T08:00:00Z';
      const patch =
        '@@ -10,2 +10,3 @@\n export function open() {\n-  return external();\n+  // Keep review context inside Alune.\n+  return details();';
      const comment = (id, body) => ({
        id,
        body,
        user: { login: 'reviewer' },
        author: { username: 'reviewer' },
        created_at: date,
      });
      let payload,
        more = false;
      if (!kind) {
        const common = {
          title: title(`在应用内查看变动与讨论 · ${number}`),
          draft: number === 94,
          updated_at: date,
        };
        payload = github
          ? {
              ...common,
              number,
              state: [89, 81].includes(number) ? 'closed' : 'open',
              merged_at: number === 89 ? date : null,
              user: { login: 'alune-contributor' },
              head: {
                label: `contributor:${branch(number)}`,
                ref: branch(number),
                sha: 'a'.repeat(40),
              },
              base: { ref: 'development', sha: 'b'.repeat(40) },
              mergeable: true,
              mergeable_state: 'clean',
              body:
                number === 94
                  ? ''
                  : '## Review context\n\n在 Alune 内阅读 **代码变动与评论**。\n\n- [x] 保留远端与分页\n- [x] 展示行号与回复\n\n`feature` → `development`',
              changed_files: number === 94 ? 0 : 31,
            }
          : {
              ...common,
              iid: number,
              state: number === 89 ? 'merged' : number === 81 ? 'closed' : 'opened',
              author: { username: 'alune-contributor', id: 7 },
              user: { can_merge: true },
              detailed_merge_status: 'mergeable',
              diff_refs: {
                head_sha: 'a'.repeat(40),
                base_sha: 'b'.repeat(40),
                start_sha: 'c'.repeat(40),
              },
              source_branch: branch(number),
              target_branch: 'main',
              description:
                number === 94
                  ? ''
                  : '## GitLab review\n\n支持自建 GitLab 的文件变动与**讨论回复**。',
              changes_count: number === 94 ? '0' : '31',
            };
      } else if (kind === 'files' || kind === 'diffs') {
        const files = Array.from({ length: number === 94 ? 0 : 31 }, (_, index) => {
          const name =
            index === 0
              ? 'src/review.ts'
              : index === 1
                ? 'assets/binary.png'
                : index === 2
                  ? 'large/generated.ts'
                  : index === 3
                    ? 'src/renamed.ts'
                    : index === 4
                      ? 'src/deleted.ts'
                      : index === 5
                        ? 'src/added.ts'
                        : `src/modules/very-long-review-context-path/file-${index}.ts`;
          const filePatch =
            index === 4
              ? '@@ -1 +0,0 @@\n-old'
              : index === 5
                ? '@@ -0,0 +1 @@\n+new'
                : control.layoutStress
                  ? patch +
                    '\n@@ -50,160 +51,160 @@\n' +
                    Array.from({ length: 160 }, (_, line) => ` const value${line} = ${line};`).join(
                      '\n',
                    )
                  : patch;
          return github
            ? {
                filename: name,
                previous_filename: index === 3 ? 'src/old.ts' : undefined,
                status:
                  index === 3
                    ? 'renamed'
                    : index === 4
                      ? 'removed'
                      : index === 5
                        ? 'added'
                        : 'modified',
                additions: index === 4 ? 0 : index === 5 ? 1 : 2,
                deletions: index === 5 ? 0 : 1,
                patch:
                  index === 1 ? undefined : index === 2 ? '@@ -1,99 +1,99 @@\n-partial' : filePatch,
              }
            : {
                new_path: name,
                old_path: index === 3 ? 'src/old.ts' : name,
                renamed_file: index === 3,
                deleted_file: index === 4,
                new_file: index === 5,
                too_large: index === 2,
                diff: index === 1 ? 'Binary files a and b differ' : index === 2 ? '' : filePatch,
              };
        });
        payload = files.slice((page - 1) * 30, page * 30);
        more = page * 30 < files.length;
      } else if (number === 94) payload = [];
      else if (kind === 'reviews')
        payload = [{ ...comment(21, ''), state: 'APPROVED', submitted_at: date }];
      else if (kind === 'discussions') {
        const first = {
          ...comment(31, '请确认这里的旧版本兼容性。'),
          resolvable: true,
          resolved: true,
          position: {
            old_path: 'src/review.ts',
            new_path: 'src/review.ts',
            old_line: null,
            new_line: 12,
          },
        };
        payload =
          page === 1
            ? [
                {
                  id: 'gitlab-thread',
                  notes: [
                    first,
                    { ...comment(32, '已补充兼容处理。'), resolvable: true, resolved: true },
                  ],
                },
                { id: 'general', notes: [comment(33, '普通评论：验证完成。')] },
              ]
            : [{ id: 'next-thread', notes: [comment(34, '下一页讨论。')] }];
        more = page === 1;
      } else if (url.pathname.includes('/issues/')) {
        payload =
          page === 1
            ? [comment(11, '普通评论：请验证 **浅色和深色主题**。')]
            : [comment(12, '下一页评论。')];
        more = page === 1;
      } else {
        const first = {
          ...comment(41, '这行是否保留了当前仓库的上下文？'),
          path: 'src/review.ts',
          side: 'RIGHT',
          line: null,
          original_line: 12,
          diff_hunk: patch,
        };
        payload =
          page === 1
            ? [first]
            : [{ ...first, id: 42, in_reply_to_id: 41, body: '已确认，并补充回归测试。' }];
        more = page === 1;
      }
      if (!kind && control.states[identity]) {
        payload.state =
          control.states[identity] === 'merged' && github ? 'closed' : control.states[identity];
        if (control.states[identity] === 'merged') payload.merged_at = date;
      }
      if (Array.isArray(payload) && ['comments', 'discussions'].includes(kind)) {
        const noteKind = !github || url.pathname.includes('/issues/') ? 'comments' : 'code';
        payload.push(...(control.notes[`${identity}:${noteKind}`] || []));
      }
      return new Response(JSON.stringify(payload), {
        headers: more ? { link: '<https://fixture.invalid/next>; rel="next"' } : {},
      });
    }
    const page = Number(url.searchParams.get('page'));
    const all = url.searchParams.get('state') === 'all';
    const items =
      page === 1
        ? [
            { number: 98, title: '支持获取仓库关联的 PR / MR', state: 'open', draft: false },
            { number: 94, title: '完善私有仓库的认证与访问提示', state: 'open', draft: true },
            ...(all
              ? [
                  { number: 89, title: '为工作区加入月光主题', state: 'merged', draft: false },
                  { number: 81, title: '更新提交历史的分支筛选', state: 'closed', draft: false },
                ]
              : []),
          ]
        : [{ number: 76, title: '分页加载更多协作记录', state: 'open', draft: false }];
    for (const item of items) {
      item.state = control.states[`${url.host}:${item.number}`] || item.state;
      item.title = title(item.title);
    }
    const data = items
      .filter((item) => all || item.state === 'open')
      .map((item) =>
        github
          ? {
              ...item,
              state: item.state === 'merged' ? 'closed' : item.state,
              merged_at: item.state === 'merged' ? '2026-09-26T08:00:00Z' : null,
              user: { login: 'alune-contributor' },
              requested_reviewers: item.number === 76 ? [{ login: 'alune-contributor' }] : [],
              head: { label: `contributor:${branch(item.number)}` },
              base: { ref: 'development', sha: 'b'.repeat(40) },
              mergeable: true,
              mergeable_state: 'clean',
              updated_at: '2026-09-26T08:00:00Z',
            }
          : {
              ...item,
              iid: item.number,
              state: item.state === 'open' ? 'opened' : item.state,
              author: { username: 'alune-contributor' },
              reviewers: item.number === 76 ? [{ username: 'alune-contributor' }] : [],
              source_branch: branch(item.number),
              target_branch: 'main',
              updated_at: '2026-09-26T08:00:00Z',
            },
      );
    return new Response(JSON.stringify(data), {
      headers: page === 1 ? { link: '<https://fixture.invalid/next>; rel="next"' } : {},
    });
  };
  const app = await startServer({ port: 0, webRoot: servedRoot });
  const connection = await app.get(ConnectionService).create({
    ...remote.options,
    name: 'PR/MR 验收服务器',
    authType: 'password',
  });
  const repositories = app.get(RepositoryService);
  const main = await repositories.add(connection.id, fixture.repo);
  const emptyRepo = await repositories.add(connection.id, empty.repo);
  const db = app.get('DATABASE');
  db.prepare('UPDATE repositories SET name = ? WHERE id = ?').run('alune', main.id);
  db.prepare('UPDATE repositories SET name = ? WHERE id = ?').run('empty-repo', emptyRepo.id);
  // Local fixture controls never exist in production.
  const controls = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text || '{}');
    if (Number.isInteger(body.status)) control.status = body.status;
    if (Number.isInteger(body.writeStatus)) control.writeStatus = body.writeStatus;
    if (Number.isInteger(body.delay)) control.delay = body.delay;
    if ('delayNumber' in body) control.delayNumber = body.delayNumber;
    if (typeof body.failPath === 'string') control.failPath = body.failPath;
    if (typeof body.layoutStress === 'boolean') control.layoutStress = body.layoutStress;
    if (body.resetCalls) control.calls.length = 0;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(control));
  });
  await new Promise((resolve) => controls.listen(0, '127.0.0.1', resolve));
  return {
    app,
    fixture,
    remote,
    main,
    emptyRepo,
    control,
    url: await app.getUrl(),
    controlUrl: `http://127.0.0.1:${controls.address().port}`,
    async close() {
      await app.close();
      await new Promise((resolve) => controls.close(resolve));
      await remote.close();
      fixture.close();
      empty.close();
      globalThis.fetch = originalFetch;
      if (previousDir === undefined) delete process.env.ALUNE_DATA_DIR;
      else process.env.ALUNE_DATA_DIR = previousDir;
    },
  };
}
module.exports = { startPullRequestsFixture };
if (require.main === module) {
  startPullRequestsFixture({
    ...(process.argv[2] ? { webRoot: path.resolve(process.argv[2]) } : {}),
  })
    .then((fixture) => {
      console.log(
        JSON.stringify({
          url: `${fixture.url}/repositories/${fixture.main.id}`,
          emptyUrl: `${fixture.url}/repositories/${fixture.emptyRepo.id}`,
          controlUrl: fixture.controlUrl,
        }),
      );
      for (const signal of ['SIGINT', 'SIGTERM'])
        process.once(signal, () => void fixture.close().then(() => process.exit(0)));
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
