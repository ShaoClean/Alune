// Hosted-platform HTTP boundary for the native smoke test. Only this child trusts
// the freshly generated loopback certificate. No external project is contacted.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export async function reviewFixture(dir) {
  const repo = path.join(dir, 'review-project'),
    cert = path.join(dir, 'loopback.crt'),
    key = path.join(dir, 'loopback.key'),
    config = path.join(dir, 'cert.cnf');
  const marker = path.join(dir, 'review-draft-typed'),
    token = 'local-test-token';
  fs.writeFileSync(
    config,
    '[req]\nprompt=no\ndistinguished_name=subject\nx509_extensions=extensions\n[subject]\nCN=Alune isolated fixture\n[extensions]\nsubjectAltName=IP:127.0.0.1\nbasicConstraints=critical,CA:TRUE\n',
  );
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-nodes',
      '-days',
      '2',
      '-newkey',
      'rsa:2048',
      '-config',
      config,
      '-keyout',
      key,
      '-out',
      cert,
    ],
    { stdio: 'pipe' },
  );
  fs.mkdirSync(repo);
  const git = (...args) =>
    execFileSync('git', ['-C', repo, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: path.join(dir, 'empty.gitconfig'),
      },
    }).trim();
  git('init', '-qb', 'main');
  git('config', 'user.email', 'fixture@invalid');
  git('config', 'user.name', 'Review Fixture');
  git('config', 'commit.gpgSign', 'false');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'base\nold\n');
  fs.writeFileSync(path.join(repo, 'old.txt'), 'unchanged content\n');
  git('add', '.');
  git('commit', '-qm', 'first');
  const base = git('rev-parse', 'HEAD');
  git('switch', '-qc', 'feature/review');
  fs.writeFileSync(path.join(repo, 'file.txt'), 'base\nfirst\nextra\n');
  git('mv', 'old.txt', 'renamed.txt');
  git('add', '.');
  git('commit', '-qm', 'automatic suggestion');
  const head = git('rev-parse', 'HEAD');
  const state = git('status', '--porcelain'),
    writes = [],
    attempts = [],
    notes = [],
    date = '2026-01-01T00:00:00Z';
  const mr = (iid, title) => ({
    iid,
    title,
    source_branch: 'feature/review',
    target_branch: 'main',
    author: { username: 'fixture' },
    user: { can_merge: true },
    state: 'opened',
    updated_at: date,
    description: 'fixture description',
    changes_count: '2',
    merge_status: 'can_be_merged',
    detailed_merge_status: 'mergeable',
    diff_refs: { head_sha: head, base_sha: base, start_sha: base },
  });
  const first = mr(98, 'Inspect the fixture change');
  const closed = { ...mr(76, 'Archived fixture request'), state: 'closed' };
  let created;
  const tokenProof = path.join(dir, 'review-credential-receipts.txt');
  fs.writeFileSync(tokenProof, '');
  const tokenReads = { initial: 0, replaced: 0 };
  const patch = '@@ -1,2 +1,3 @@\n base\n-old\n+first\n+extra';
  const server = https.createServer(
    { cert: fs.readFileSync(cert), key: fs.readFileSync(key) },
    async (req, res) => {
      const json = (obj, status = 200) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(obj));
      try {
        const url = new URL(req.url, 'https://127.0.0.1'),
          project = '/api/v4/projects/team%2Freview',
          route = url.pathname.slice(project.length);
        if (req.method === 'GET' && url.pathname.includes('/merge_requests')) {
          const category =
            req.headers['private-token'] === 'smoke-named-initial'
              ? 'initial'
              : req.headers['private-token'] === 'smoke-named-replacement'
                ? 'replaced'
                : null;
          if (category) {
            tokenReads[category]++;
            fs.appendFileSync(tokenProof, category + '\n');
          }
        }
        if (url.pathname === '/api/v4/user') return json({ id: 7, username: 'fixture' });
        if (!url.pathname.startsWith(project)) return json({}, 404);
        if (req.method !== 'GET')
          attempts.push({
            method: req.method,
            route,
            authenticated: req.headers['private-token'] === token,
          });
        if (req.method === 'POST') {
          if (req.headers['private-token'] !== token) return json({}, 403);
          const parts = [];
          for await (const b of req) parts.push(b);
          const body = JSON.parse(Buffer.concat(parts).toString());
          if (route === '/merge_requests/98/notes' || route === '/merge_requests/98/discussions') {
            writes.push({ route, body });
            const note = {
              id: 1001 + notes.length,
              body: body.body,
              author: { username: 'fixture' },
              created_at: date,
              ...(body.position ? { position: body.position } : {}),
            };
            const thread = { id: String(note.id), notes: [note] };
            notes.push(thread);
            return json(body.position ? thread : note, 201);
          }
          if (route === '/merge_requests') {
            writes.push({ route, body });
            created = {
              ...mr(201, body.title),
              draft: body.title.startsWith('Draft:'),
              description: body.description,
              source_branch: body.source_branch,
              target_branch: body.target_branch,
            };
            return json(created, 201);
          }
          return json({}, 405);
        }
        if (req.method !== 'GET') return json({}, 405);
        if (!route)
          return json({
            default_branch: 'main',
            permissions: { project_access: { access_level: 40 } },
            merge_method: 'merge',
            squash_option: 'default_off',
          });
        if (route === '/merge_requests') {
          if (url.searchParams.has('source_branch')) return json(created ? [created] : []);
          const all = [...(created ? [created] : []), first, closed],
            filter = url.searchParams.get('state');
          return json(filter && filter !== 'all' ? all.filter((x) => x.state === filter) : all);
        }
        if (route.match(/^\/merge_requests\/(76|98|201)$/))
          return json(route.endsWith('201') ? created : route.endsWith('76') ? closed : first);
        if (route.endsWith('/diffs'))
          return json([
            { old_path: 'file.txt', new_path: 'file.txt', diff: patch },
            { old_path: 'old.txt', new_path: 'renamed.txt', renamed_file: true, diff: patch },
          ]);
        if (route.endsWith('/discussions')) return json(notes);
        if (route === '/repository/branches')
          return json([{ name: 'main' }, { name: 'feature/review' }]);
        if (route.startsWith('/repository/branches/'))
          return json({
            commit: { id: decodeURIComponent(route).endsWith('feature/review') ? head : base },
          });
        if (route === '/repository/compare') {
          const deadline = Date.now() + 20000;
          while (!fs.existsSync(marker)) {
            if (res.destroyed) return;
            if (Date.now() > deadline) return json({}, 408);
            await delay(40);
          }
          return json({
            commits: [{ id: head, message: 'automatic suggestion' }],
            diffs: [{ old_path: 'file.txt', new_path: 'file.txt', diff: patch }],
          });
        }
        if (route.startsWith('/repository/files/'))
          return json({
            encoding: 'base64',
            content: Buffer.from('Automatic description').toString('base64'),
          });
        if (route.endsWith('/members/all') || route === '/labels') return json([]);
        return json({}, 404);
      } catch (e) {
        if (!res.destroyed) json({ message: e.message }, 500);
      }
    },
  );
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  const url = 'https://127.0.0.1:' + server.address().port + '/team/review.git';
  git('remote', 'add', 'origin', url);
  return {
    env: {
      NODE_EXTRA_CA_CERTS: cert,
      ALUNE_TEST_TOKEN_PROOF: tokenProof,
      ALUNE_TEST_REVIEW_REPO: repo,
      ALUNE_TEST_REVIEW_URL: url,
      ALUNE_TEST_REVIEW_MARKER: marker,
    },
    verify() {
      assert.equal(
        writes.length,
        3,
        'one range comment, one ordinary comment and one draft; dismissing confirms no other writes',
      );
      assert.equal(
        attempts.length,
        writes.length,
        'cancelled actions must never reach the network',
      );
      assert(attempts.every((x) => x.authenticated));
      const inline = writes[0];
      assert.equal(inline.route, '/merge_requests/98/discussions');
      assert.equal(inline.body.body, 'Local range comment');
      assert.equal(inline.body.position.new_path, 'file.txt');
      assert.equal(inline.body.position.head_sha, head);
      assert.equal(inline.body.position.base_sha, base);
      assert.equal(inline.body.position.line_range.start.new_line, 2);
      assert.equal(inline.body.position.line_range.end.new_line, 3);
      assert.equal(writes[1].route, '/merge_requests/98/notes');
      assert.equal(writes[1].body.body, 'A local-only UI acceptance comment');
      assert.equal(writes[2].route, '/merge_requests');
      assert.equal(created.title.replace(/^Draft: /, ''), 'Controlled draft from UI');
      assert.equal(created.description, 'Only sent to the disposable HTTPS peer.');
      assert.equal(created.draft, true);
      assert.equal(created.source_branch, 'feature/review');
      assert.equal(created.target_branch, 'main');
      assert.equal(git('status', '--porcelain'), state);
    },
    verifyTokens() {
      assert.ok(
        tokenReads.initial > 0 && tokenReads.replaced > 0,
        'each named credential must actually reach the loopback provider',
      );
    },
    async close() {
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
    },
  };
}
