// Demo-only settings for the workspace screenshot fixture. All writes stay in memory.
const secretStorage = { available: true, description: '隔离的演示环境，不保存真实凭据' };
let ai = {
  revision: 'demo-1',
  secretStorage,
  providers: ['OpenAI', 'Anthropic', 'Gemini', 'DeepSeek', '团队 AI 网关'].map((name, i) => ({
    id: `provider-${i}`,
    name,
    builtin: i < 4,
    protocol: ['openai', 'anthropic', 'gemini', 'openai', 'openai'][i],
    baseUrl: 'https://api.example.invalid/v1',
    enabled: i === 0 || i === 4,
    hasApiKey: i === 0,
    models: [
      { id: 'demo-model', name: 'Demo Model', enabled: true },
      { id: 'demo-review', name: 'Demo Review', enabled: false },
    ],
  })),
  commit: {
    providerId: 'provider-0',
    modelId: 'demo-model',
    language: 'zh-CN',
    format: 'conventional',
    prompt: '',
  },
};
let proxy = {
  revision: 'proxy-1',
  enabled: false,
  protocol: 'http',
  host: '127.0.0.1',
  port: 7890,
  authEnabled: false,
  hasCredentials: false,
  secretStorageAvailable: true,
};
let tokens = {
  revision: 'tokens-1',
  secretStorage,
  tokens: [
    {
      id: 'demo-token',
      name: '团队代码审阅',
      version: '1',
      updatedAt: '2026-09-30T00:00:00.000Z',
      scope: { provider: 'github', origin: 'https://github.com' },
      associations: [
        {
          repositoryId: 'repo-a',
          repositoryName: 'alune',
          remote: 'origin',
          target: 'https://github.com/example/alune.git',
        },
      ],
    },
  ],
};
let revision = 1;
export async function settingsFixture(request, response, pathname) {
  if (!/^\/api\/(ai|network-proxy|access-tokens)(\/|$)/.test(pathname)) return false;
  let text = '';
  for await (const chunk of request) text += chunk;
  const body = text ? JSON.parse(text) : {};
  const send = (data) =>
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(data));
  if (pathname === '/api/network-proxy/connections')
    send([
      {
        id: 'dev',
        name: '开发服务器',
        connected: false,
        connecting: false,
        revision: null,
        pendingReconnect: false,
        activeTasks: 0,
        forwarding: 'disabled',
      },
    ]);
  else if (pathname === '/api/network-proxy/test')
    send({ revision: proxy.revision, success: true, elapsedMs: 24, message: '演示连接测试成功' });
  else if (pathname === '/api/network-proxy') {
    if (request.method === 'PUT') proxy = { ...proxy, ...body, revision: `proxy-${++revision}` };
    send(proxy);
  } else if (pathname.startsWith('/api/access-tokens')) {
    const id = pathname.split('/')[3];
    if (request.method === 'POST')
      tokens.tokens.push({
        id: `token-${++revision}`,
        name: body.name,
        version: '1',
        updatedAt: new Date().toISOString(),
        scope: null,
        associations: [],
      });
    if (request.method === 'PUT')
      tokens.tokens = tokens.tokens.map((token) =>
        token.id === id ? { ...token, name: body.name } : token,
      );
    if (request.method === 'DELETE')
      tokens.tokens = tokens.tokens.filter((token) => token.id !== id);
    tokens.revision = `tokens-${++revision}`;
    send(tokens);
  } else if (pathname.endsWith('/test')) send({ message: '演示连接测试成功' });
  else {
    if (pathname === '/api/ai/commit-settings') ai.commit = body.commit;
    if (/\/providers(?:\/[^/]+)?$/.test(pathname) && body.provider) {
      const id = pathname.split('/')[4];
      if (id)
        ai.providers = ai.providers.map((provider) =>
          provider.id === id ? { ...provider, ...body.provider } : provider,
        );
      else
        ai.providers.push({
          ...body.provider,
          id: `provider-${++revision}`,
          builtin: false,
          hasApiKey: false,
        });
    }
    if (request.method !== 'GET') ai.revision = `demo-${++revision}`;
    send(ai);
  }
  return true;
}
