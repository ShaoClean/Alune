import assert from 'node:assert/strict';
export const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// Normalize ONLY named nondeterministic IDs after validating format/correlation.
// Other fields are preserved, and still compared to the independent fixture.
export function normalizeOperation(params, expected, state) {
  if (!expected || !params) return params;
  const key = expected.operationId === '$operationId' ? 'operationId' : expected.taskId === '$operationId' ? 'taskId' : null;
  if (!key) return params;
  assert.match(params[key], uuidV4);
  if (key === 'operationId') {
    if (state.operationId) assert.equal(params[key], state.operationId, 'write operation identity changed');
    else state.operationId = params[key];
  } else assert.equal(params[key], state.operationId, 'task lookup must use the dispatched operation ID');
  return { ...params, [key]: '$operationId' };
}
