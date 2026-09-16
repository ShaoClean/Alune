import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendGraph, emptyGraph } from '../src/components/commit-graph.ts';
const commit = (hash, ...parents) => ({ hash, parents });
const history = [
  commit('merge', 'main', 'feature', 'third'),
  commit('other-tip', 'other-root'),
  commit('main', 'shared'),
  commit('feature', 'feature-base'),
  commit('third', 'shared'),
  commit('feature-base', 'shared'),
  commit('shared', 'root'),
  commit('root'),
  commit('other-root'),
];

test('linear history starts at its tip, joins every parent and stops at its root', () => {
  const graph = appendGraph(emptyGraph(), [commit('a', 'b'), commit('b', 'c'), commit('c')]);
  assert.deepEqual(
    graph.rows.map((row) => row.lane),
    [0, 0, 0],
  );
  assert.deepEqual(
    graph.rows[0].edges.map((edge) => edge.half),
    ['bottom'],
  );
  assert.deepEqual(
    graph.rows[1].edges.map((edge) => edge.half),
    ['top', 'bottom'],
  );
  assert.deepEqual(
    graph.rows[2].edges.map((edge) => edge.half),
    ['top'],
  );
  assert.ok(graph.lanes.every((lane) => lane === null));
});

test('merges, octopus merges and disconnected roots retain exactly the unresolved parent targets', () => {
  let graph = emptyGraph();
  const pending = new Set();
  let frontier = [];
  for (const item of history) {
    const expectedIncoming = pending.has(item.hash);
    graph = appendGraph(graph, [item]);
    const row = graph.rows.at(-1);
    assert.equal(
      row.edges.some((edge) => edge.half === 'top'),
      expectedIncoming,
    );
    assert.deepEqual(
      row.edges.filter((edge) => edge.half === 'bottom').map((edge) => edge.target),
      item.parents,
    );
    for (const edge of row.edges.filter((edge) => edge.half !== 'bottom')) {
      assert.equal(frontier[edge.from]?.target, edge.target);
      if (edge.half === 'top') assert.equal(edge.to, row.lane);
    }
    for (const edge of row.edges.filter((edge) => edge.half !== 'top'))
      assert.equal(graph.lanes[edge.to]?.target, edge.target);
    pending.delete(item.hash);
    item.parents.forEach((parent) => pending.add(parent));
    const actual = graph.lanes.filter(Boolean).map((lane) => lane.target);
    assert.equal(new Set(actual).size, actual.length);
    assert.deepEqual(new Set(actual), pending);
    frontier = graph.lanes;
  }
  assert.equal(pending.size, 0);
});

test('every possible page boundary preserves all existing geometry and colors', () => {
  const full = appendGraph(emptyGraph(), history);
  for (let split = 1; split < history.length; split++) {
    const first = appendGraph(emptyGraph(), history.slice(0, split));
    const frozen = structuredClone(first);
    const final = appendGraph(first, history.slice(split));
    assert.deepEqual(first, frozen);
    assert.deepEqual(final, full);
    assert.deepEqual(final.rows.slice(0, split), first.rows);
  }
});

test('a parent below the loaded page remains an open edge, and a new branch has no false incoming edge', () => {
  const graph = appendGraph(emptyGraph(), [
    commit('first', 'pending'),
    commit('new-tip', 'pending'),
  ]);
  assert.equal(graph.rows[1].edges.filter((edge) => edge.half === 'top').length, 0);
  assert.deepEqual(
    graph.lanes.filter(Boolean).map((lane) => lane.target),
    ['pending'],
  );
  assert.notEqual(graph.rows[0].lane, graph.rows[1].lane);
});
