import { createServer, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { AiProtocol } from '@remote-git/shared';
import type { ConnectionService } from '../connection/connection.service';
import type { RepositoryService } from '../repository/repository.service';
import { AiSettingsStore } from './ai-settings';
import { AiService } from './ai.service';
import { parseCommit } from './ai-provider';
import { localSecretStorage } from './secret-storage';
const {
  createRepository,
} = require('../../../../packages/ssh-client/tests/helpers/local-repository.cjs');

describe('AI service with real isolated Git and mock HTTP providers', () => {
  let server: Server;
  let baseUrl: string;
  let mode: string;
  let requests: { path: string; headers: any; body: any }[];
  let f: ReturnType<typeof createRepository>;
  let store: AiSettingsStore;
  let service: AiService;
  let onCompletion: (() => void) | undefined;
  const generated = {
    message: 'feat: 保留 "引号" 与 $(literal)',
    description: '正文第一行\n\n第二行 `literal`',
  };

  beforeAll(async () => {
    server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length
        ? JSON.parse(Buffer.concat(chunks).toString())
        : undefined;
      requests.push({ path: req.url!, headers: req.headers, body });
      if (mode === 'hang') return;
      res.setHeader('Content-Type', 'application/json');
      if (mode === 'auth' || mode === 'locked') {
        res.writeHead(mode === 'locked' ? 423 : 401);
        res.end(
          JSON.stringify({ error: 'DO_NOT_EXPOSE api-secret echoed by proxy' }),
        );
        return;
      }
      if (mode === 'no-models' && req.method === 'GET') {
        res.writeHead(404);
        res.end('{}');
        return;
      }
      if (req.method === 'GET') {
        const paged = mode.startsWith('pages');
        const second = /pageToken=|after_id=/.test(req.url || '');
        if (mode === 'pages-fail' && second) {
          res.writeHead(503);
          res.end('{}');
          return;
        }
        const modelId = second ? 'paged-model' : 'new-model';
        if (req.url?.startsWith('/gemini'))
          res.end(
            JSON.stringify({
              models: [
                {
                  name: `models/${modelId}`,
                  displayName: 'New model',
                  supportedGenerationMethods: ['generateContent'],
                },
                {
                  name: 'models/embed',
                  supportedGenerationMethods: ['embedContent'],
                },
              ],
              ...(paged && !second ? { nextPageToken: 'next-page' } : {}),
            }),
          );
        else
          res.end(
            JSON.stringify({
              data: [{ id: modelId, display_name: 'New model' }],
              ...(paged && !second
                ? { has_more: true, last_id: 'next-page' }
                : {}),
            }),
          );
        return;
      }
      onCompletion?.();
      const text =
        mode === 'empty'
          ? ''
          : mode === 'bad-json'
            ? 'not JSON'
            : JSON.stringify(generated);
      const payload = req.url?.endsWith('/messages')
        ? { content: [{ type: 'text', text }] }
        : req.url?.includes(':generateContent')
          ? { candidates: [{ content: { parts: [{ text }] } }] }
          : { choices: [{ message: { content: text } }] };
      res.end(JSON.stringify(payload));
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  beforeEach(() => {
    mode = 'success';
    requests = [];
    onCompletion = undefined;
    f = createRepository();
    f.write('change.txt', 'STAGED_DATA\n');
    f.git('add', 'change.txt');
    f.write('change.txt', 'UNSTAGED_PRIVATE_DATA\n');
    store = new AiSettingsStore(
      join(f.root, 'ai.json'),
      localSecretStorage(f.root),
    );
    service = new AiService(
      store,
      {
        ensureConnected: async () => f.connection,
      } as unknown as ConnectionService,
      {
        get: async () => ({ connectionId: 'fixture', path: f.repo }),
      } as unknown as RepositoryService,
    );
  });
  afterEach(() => {
    service.onModuleDestroy();
    f.close();
    jest.restoreAllMocks();
  });

  function configure(protocol: AiProtocol, builtin?: string) {
    const next = store.saveProvider(
      builtin,
      {
        name: 'Fixture',
        protocol,
        baseUrl: `${baseUrl}/${protocol}`,
        enabled: true,
        models: [{ id: 'fixture-model', name: 'Fixture model', enabled: true }],
        apiKey: 'api-secret',
      },
      store.read().revision,
    );
    const id = builtin || next.providers.at(-1)!.id;
    store.saveCommit(
      {
        providerId: id,
        modelId: 'fixture-model',
        language: 'zh-CN',
        format: 'conventional',
        prompt: 'Mention issue 21',
      },
      store.read().revision,
    );
    return id;
  }
  const generate = (signal = new AbortController().signal) =>
    service.run(signal, (s) =>
      service.generate('fixture', store.read().revision, s),
    );

  it.each([
    ['openai', 'openai'],
    ['anthropic', 'anthropic'],
    ['gemini', 'gemini'],
    ['openai', 'deepseek'],
    ['openai', undefined],
    ['anthropic', undefined],
    ['gemini', undefined],
  ] as [AiProtocol, string | undefined][])(
    'adapts %s (%s), sending staged data only and retaining the index',
    async (protocol, builtin) => {
      configure(protocol, builtin);
      const index = f.git('ls-files', '--stage', '-z');
      const head = f.git('rev-parse', 'HEAD');
      const result = await generate();
      expect(result).toMatchObject(generated);
      expect(result.configRevision).toBe(store.read().revision);
      expect(result.stagedRevision).toMatch(/^[a-f\d]{64}$/);
      const sent = JSON.stringify(requests[0].body);
      expect(sent).toContain('STAGED_DATA');
      expect(sent).not.toContain('UNSTAGED_PRIVATE_DATA');
      expect(sent).toContain('Simplified Chinese');
      expect(sent).toContain('Conventional Commits');
      expect(sent).toContain('Mention issue 21');
      expect(sent).not.toContain('api-secret');
      expect(
        requests[0].headers[
          protocol === 'gemini'
            ? 'x-goog-api-key'
            : protocol === 'anthropic'
              ? 'x-api-key'
              : 'authorization'
        ],
      ).toBe(protocol === 'openai' ? 'Bearer api-secret' : 'api-secret');
      expect(f.git('ls-files', '--stage', '-z')).toBe(index);
      expect(f.git('rev-parse', 'HEAD')).toBe(head);
    },
  );

  it.each([
    ['openai', 'OPENAI_API_KEY', 'authorization'],
    ['anthropic', 'ANTHROPIC_API_KEY', 'x-api-key'],
    ['gemini', 'GEMINI_API_KEY', 'x-goog-api-key'],
  ] as [AiProtocol, string, string][])(
    'uses manually updated %s keys and does not fall back to environment credentials',
    async (protocol, variable, header) => {
      const previous = process.env[variable];
      process.env[variable] = 'ignored-environment-api-key';
      try {
        const id = configure(protocol);
        store.saveProvider(
          id,
          { ...store.provider(id), apiKey: 'manually-updated-api-key' },
          store.read().revision,
        );
        await generate();
        expect(requests.at(-1)?.headers[header]).toBe(
          protocol === 'openai'
            ? 'Bearer manually-updated-api-key'
            : 'manually-updated-api-key',
        );
        store.saveProvider(
          id,
          { ...store.provider(id), apiKey: null },
          store.read().revision,
        );
        await generate();
        expect(requests.at(-1)?.headers[header]).toBeUndefined();
      } finally {
        if (previous === undefined) delete process.env[variable];
        else process.env[variable] = previous;
      }
    },
  );

  it.each(['openai', 'anthropic', 'gemini'] as AiProtocol[])(
    'fetches %s models without replacing manual names or enabled flags',
    async (protocol) => {
      const id = configure(protocol);
      await service.run(new AbortController().signal, (s) =>
        service.models(id, store.read().revision, s),
      );
      expect(store.provider(id).models).toEqual([
        { id: 'fixture-model', name: 'Fixture model', enabled: true },
        { id: 'new-model', name: 'New model', enabled: false },
      ]);
      const previous = store.read();
      mode = 'no-models';
      await expect(
        service.run(new AbortController().signal, (s) =>
          service.models(id, previous.revision, s),
        ),
      ).rejects.toThrow('接口或模型不存在');
      expect(store.read()).toEqual(previous);
    },
  );

  it('validates a real completion when testing a saved model and applies language/format preferences', async () => {
    const id = configure('openai');
    await expect(
      service.run(new AbortController().signal, (s) =>
        service.test(id, store.read().revision, s),
      ),
    ).resolves.toMatchObject({
      message: expect.stringContaining('fixture-model'),
    });
    store.saveCommit(
      { ...store.read().commit, language: 'en', format: 'natural' },
      store.read().revision,
    );
    await generate();
    expect(JSON.stringify(requests.at(-1)?.body)).toContain('Write in English');
    expect(JSON.stringify(requests.at(-1)?.body)).toContain('natural-language');
  });

  it.each(['openai', 'anthropic', 'gemini'] as AiProtocol[])(
    'tests the explicitly selected %s model, including disabled models, without changing commit preferences',
    async (protocol) => {
      const id = configure(protocol);
      const provider = store.provider(id);
      store.saveProvider(
        id,
        {
          ...provider,
          models: [
            ...provider.models,
            { id: 'second-model', name: 'Second model', enabled: false },
          ],
        },
        store.read().revision,
      );
      const before = store.read();
      await expect(
        service.run(new AbortController().signal, (s) =>
          service.test(id, before.revision, s, 'second-model'),
        ),
      ).resolves.toEqual({ message: '连接成功，已验证模型 second-model。' });
      expect(requests).toHaveLength(1);
      if (protocol === 'gemini')
        expect(requests[0].path).toBe(
          '/gemini/models/second-model:generateContent',
        );
      else expect(requests[0].body.model).toBe('second-model');
      expect(store.read()).toEqual(before);
      expect(store.read().commit.modelId).toBe('fixture-model');
    },
  );

  it('can explicitly test only the model list even when completion models are enabled', async () => {
    const id = configure('openai');
    const before = store.read();
    await expect(
      service.run(new AbortController().signal, (s) =>
        service.test(id, before.revision, s, null),
      ),
    ).resolves.toEqual({ message: '连接成功，已验证模型列表接口。' });
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe('/openai/models');
    expect(requests[0].body).toBeUndefined();
    expect(store.read()).toEqual(before);
  });

  it('rejects unsaved, other-provider and malformed test selections without an external request', async () => {
    const id = configure('openai');
    store.saveProvider(
      undefined,
      {
        ...store.provider(id),
        name: 'Other provider',
        models: [{ id: 'other-model', name: 'Other', enabled: true }],
      },
      store.read().revision,
    );
    for (const model of ['unknown-model', 'other-model', '', 42, {}]) {
      await expect(
        service.run(new AbortController().signal, (s) =>
          service.test(id, store.read().revision, s, model as string),
        ),
      ).rejects.toThrow('请选择此服务商已保存的测试模型');
    }
    expect(requests).toHaveLength(0);
  });

  it.each(['anthropic', 'gemini'] as AiProtocol[])(
    'completes %s pagination atomically and preserves existing models on a later-page failure',
    async (protocol) => {
      const id = configure(protocol);
      mode = 'pages-fail';
      const before = store.read();
      await expect(
        service.run(new AbortController().signal, (signal) =>
          service.models(id, before.revision, signal),
        ),
      ).rejects.toThrow('HTTP 503');
      expect(store.read()).toEqual(before);
      mode = 'pages';
      requests = [];
      await service.run(new AbortController().signal, (signal) =>
        service.models(id, before.revision, signal),
      );
      expect(requests).toHaveLength(2);
      expect(requests[1].path).toContain(
        protocol === 'gemini' ? 'pageToken=next-page' : 'after_id=next-page',
      );
      expect(store.provider(id).models.map((model) => model.id)).toEqual([
        'fixture-model',
        'new-model',
        'paged-model',
      ]);
    },
  );

  it.each([
    ['auth', '认证失败'],
    ['locked', '网关拒绝了请求（HTTP 423）'],
    ['empty', '未返回文本'],
    ['bad-json', '有效的提交'],
  ])(
    'maps %s to a readable error and does not echo credentials',
    async (failure, expected) => {
      configure('openai');
      mode = failure;
      await expect(generate()).rejects.toThrow(expected);
      try {
        await generate();
      } catch (error) {
        expect(JSON.stringify(error)).not.toMatch(/DO_NOT_EXPOSE|api-secret/);
      }
    },
  );

  it('preserves models and preferences when model discovery is rejected with HTTP 423', async () => {
    const id = configure('openai');
    const before = store.read();
    mode = 'locked';
    await expect(
      service.run(new AbortController().signal, (s) =>
        service.models(id, before.revision, s),
      ),
    ).rejects.toThrow('请检查服务状态、账号权限及网关访问规则');
    expect(store.read()).toEqual(before);
    expect(requests).toHaveLength(1);
  });

  it('discards results if the same staged file or configuration changes during the request', async () => {
    configure('openai');
    onCompletion = () => {
      f.write('change.txt', 'RESTAGED\n');
      f.git('add', 'change.txt');
    };
    await expect(generate()).rejects.toThrow('暂存内容已变化');
    onCompletion = () => {
      store.saveCommit(
        { ...store.read().commit, language: 'en' },
        store.read().revision,
      );
    };
    await expect(generate()).rejects.toThrow('AI 配置已变化');
  });

  it('cancels active HTTP requests and reports bounded timeout without modifying drafts or Git', async () => {
    configure('openai');
    mode = 'hang';
    const controller = new AbortController();
    const pending = generate(controller.signal);
    const abort = setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toThrow('已取消');
    clearTimeout(abort);
    const timeout = AbortSignal.timeout.bind(AbortSignal);
    jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => timeout(100));
    await expect(generate()).rejects.toThrow('请求超时');
    expect(f.git('show', ':change.txt')).toBe('STAGED_DATA\n');
  });

  it('rejects unconfigured generation and invalid output fields', async () => {
    await expect(generate()).rejects.toThrow('选择已启用');
    expect(requests).toHaveLength(0);
    for (const output of [
      '{}',
      '{"message":"","description":""}',
      '{"message":"a\\nb","description":""}',
      'null',
    ])
      expect(() => parseCommit(output)).toThrow();
    expect(
      parseCommit('```json\n' + JSON.stringify(generated) + '\n```'),
    ).toEqual(generated);
  });
});
