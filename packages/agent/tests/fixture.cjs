// Only integration tests import this entry; it is not included in standalone packages.
const { appendFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { randomUUID } = require('node:crypto');
const { serveStdio } = require('../dist');
const { isRecord, ProtocolError } = require('@alune/protocol');
const validate = (p) => {
  if (!isRecord(p) || !Number.isInteger(p.ms) || p.ms < 0 || p.ms > 2000)
    throw new ProtocolError('invalid-params', 'Invalid fixture delay');
};
const root = process.env.ALUNE_FIXTURE_DIR;
const handlers = {
  'fixture.hold': {
    effect: 'query',
    validate() {},
    run(_p, ctx) {
      return new Promise((_resolve, reject) =>
        ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), { once: true }),
      );
    },
  },
  'fixture.invalidAsyncValidation': {
    effect: 'mutation',
    async validate() {
      throw new Error('invalid shape');
    },
    run() {
      appendFileSync(join(root, 'invalid-write'), 'bad');
      return null;
    },
  },
  'fixture.completed': {
    effect: 'mutation',
    validate() {},
    run(_p, ctx) {
      ctx.signal.addEventListener('abort', () => appendFileSync(join(root, 'late-abort'), 'bad'));
      return { completed: true };
    },
  },
  'fixture.delay': {
    effect: 'query',
    validate,
    async run(p, ctx) {
      await delay(p.ms, null, { signal: ctx.signal });
      return { value: p.value ?? null };
    },
  },
  'fixture.ignoreCancel': {
    effect: 'query',
    validate,
    async run(p) {
      await delay(p.ms);
      return { completed: true };
    },
  },
  'fixture.mutate': {
    effect: 'mutation',
    validate,
    async run(p, ctx) {
      appendFileSync(join(root, 'writes.txt'), 'write\n');
      await delay(p.ms, null, { signal: ctx.signal });
      return { completed: true };
    },
  },
  'fixture.crash': {
    effect: 'mutation',
    validate() {},
    run() {
      appendFileSync(join(root, 'writes.txt'), 'write\n');
      process.exit(7);
    },
  },
  'fixture.stream': {
    effect: 'query',
    validate() {},
    async run(_p, ctx) {
      for (let i = 0; i < 10; i++)
        await ctx.events.write(
          'fixture.output',
          { i, text: '中'.repeat(100) },
          undefined,
          ctx.signal,
        );
      return { count: 10 };
    },
  },
  'fixture.flood': {
    effect: 'query',
    validate() {},
    run(_p, ctx) {
      for (let i = 0; i < 10000; i++) ctx.events.notifyState('fixture.state', { i });
      return { latest: 9999 };
    },
  },
};
serveStdio({
  agentId: randomUUID(),
  version: 'fixture',
  handlers,
  onDispose: async () => writeFileSync(join(root, 'disposed'), 'yes'),
}).then(
  () => process.exit(0),
  (error) => {
    process.stderr.write(error.message);
    process.exit(1);
  },
);
