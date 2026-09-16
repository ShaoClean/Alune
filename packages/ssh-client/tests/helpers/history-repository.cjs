const { createRepository } = require('./local-repository.cjs');

function createHistoryRepository(count = 155) {
  const fixture = createRepository();
  const { git, write } = fixture;
  git('branch', '-M', 'main');
  const tree = git('rev-parse', 'HEAD^{tree}').trim();
  const root = git('rev-parse', 'HEAD').trim();
  const chain = [root];
  const commit = (message, parents, commitTree = tree) =>
    git(
      'commit-tree',
      commitTree,
      ...parents.flatMap((parent) => ['-p', parent]),
      '-m',
      message,
    ).trim();
  for (let i = 1; i < count; i++) chain.push(commit('历史提交 ' + i, [chain.at(-1)]));
  git('update-ref', 'refs/heads/main', chain.at(-1));
  git('reset', '--hard', 'main');
  git('checkout', '-qb', 'feature/graph', chain.at(-4));
  write('graph.ts', 'export const graph = true;\n');
  git('add', '.');
  git('commit', '-qm', 'feat: 绘制真实提交拓扑');
  const feature = git('rev-parse', 'HEAD').trim();
  git('checkout', '-q', 'main');
  git('merge', '--no-ff', '-qm', 'merge: 合并提交图功能', 'feature/graph');
  const merge = git('rev-parse', 'HEAD').trim();
  const local = commit('feat: 本地分支独有提交', [chain.at(-8)]);
  const remote = commit('feat: 远程跟踪分支独有提交', [chain.at(-12)]);
  git('update-ref', 'refs/heads/local-only', local);
  git('update-ref', 'refs/remotes/upstream/remote-only', remote);
  git('update-ref', 'refs/remotes/upstream/main', merge);
  git('symbolic-ref', 'refs/remotes/upstream/HEAD', 'refs/remotes/upstream/main');
  git('tag', '-a', 'v1.0,preview', '-m', 'Annotated tag', merge);
  const tagOnly = commit('标签独有的提交', [root]);
  git('tag', 'tag-only', tagOnly);
  return { ...fixture, commit, chain, feature, merge, local, remote, tagOnly };
}
module.exports = { createHistoryRepository };
