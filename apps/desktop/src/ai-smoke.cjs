const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

module.exports = async ({ backend, origin, token, window, restore = false }) => {
  const { AiService } = require('./server/ai/ai.service');
  const settings = backend.get(AiService).settings;
  const marker = join(process.env.REMOTE_GIT_DATA_DIR, 'ai-smoke.json');
  const key = 'isolated-desktop-fixture-key';
  if (restore) {
    const { id, protectedKey } = JSON.parse(readFileSync(marker, 'utf8'));
    assert.equal(settings.provider(id).hasApiKey, protectedKey);
    if (protectedKey) assert.equal(settings.key(id), key);
    assert.equal(settings.read().commit.providerId, id);
    assert.equal(settings.read().commit.language, 'en');
    console.log('Desktop AI preferences and protected keys survived a process restart.');
    return;
  }
  const mock = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    assert.equal(JSON.parse(Buffer.concat(chunks).toString()).model, 'test-only-model');
    assert.equal(
      req.headers.authorization || '',
      settings.secrets.available ? `Bearer ${key}` : '',
    );
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  try {
    const call = async (path, method, body) => {
      const response = await fetch(`${origin}/api/ai/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      assert.ok(response.ok, `AI endpoint ${path}: ${response.status}`);
      return response.json();
    };
    let config = await call('settings', 'GET');
    config = await call('providers', 'POST', {
      revision: config.revision,
      provider: {
        name: 'Desktop AI smoke',
        protocol: 'openai',
        baseUrl: `http://127.0.0.1:${mock.address().port}/v1`,
        enabled: true,
        models: [
          { id: 'fixture-model', name: 'Fixture', enabled: true },
          { id: 'test-only-model', name: 'Test only', enabled: false },
        ],
        ...(config.secretStorage.available ? { apiKey: key } : {}),
      },
    });
    const id = config.providers.at(-1).id;
    assert.equal(JSON.stringify(config).includes(key), false);
    assert.equal(
      readFileSync(join(process.env.REMOTE_GIT_DATA_DIR, 'ai-settings.json'), 'utf8').includes(key),
      false,
    );
    const tested = await call(`providers/${id}/test`, 'POST', {
      revision: config.revision,
      modelId: 'test-only-model',
    });
    assert.equal(tested.message, '连接成功，已验证模型 test-only-model。');
    config = await call('commit-settings', 'PUT', {
      revision: config.revision,
      commit: {
        providerId: id,
        modelId: 'fixture-model',
        language: 'en',
        format: 'natural',
        prompt: 'Keep it concise.',
      },
    });
    writeFileSync(marker, JSON.stringify({ id, protectedKey: config.secretStorage.available }));
    console.log(
      `Desktop AI API and connection test passed (OS-protected storage: ${config.secretStorage.available}).`,
    );
    const originalSize = window.getSize();
    const execute = (script) => window.webContents.executeJavaScript(script);
    const wait = (condition) =>
      execute(`new Promise((resolve, reject) => {
      const started = Date.now();
      const check = () => {
        if (${condition}) return resolve(true);
        if (Date.now() - started > 5000) return reject(new Error('Responsive settings did not appear'));
        setTimeout(check, 30);
      }; check();
    })`);
    try {
      await execute(`window.dispatchEvent(new KeyboardEvent('keydown', { key: ',', ctrlKey: true }))`);
      window.setSize(390, 844);
      await wait(
        `document.querySelector('select[aria-label="设置分类"]')?.getClientRects().length && document.querySelector('.provider-list__item')`,
      );
      assert.equal(await execute('document.documentElement.scrollWidth <= innerWidth'), true);
      await execute(
        `Array.from(document.querySelectorAll('.provider-list__item')).find(button => button.textContent.includes('Desktop AI smoke')).click()`,
      );
      await wait(`document.querySelector('.provider-detail')?.getClientRects().length > 0`);
      assert.equal(await execute('document.documentElement.scrollWidth <= innerWidth'), true);
      assert.equal(
        await execute(`document.querySelector('input[aria-label="API Key"]').value`),
        '',
      );
      if (process.env.REMOTE_GIT_AI_SMOKE_SCREENSHOT)
        writeFileSync(
          process.env.REMOTE_GIT_AI_SMOKE_SCREENSHOT,
          (await window.webContents.capturePage()).toPNG(),
        );
      await execute(
        `Array.from(document.querySelectorAll('.provider-mobile-back')).find(button => button.getClientRects().length).click()`,
      );
      await wait(`document.querySelector('.provider-list')?.getClientRects().length > 0`);
      await execute(`document.querySelector('.settings-header button').click()`);
      console.log(
        'Desktop narrow settings passed: 390 px provider list/detail, masked key and return to workspace.',
      );
    } finally {
      window.setSize(...originalSize);
    }
  } finally {
    mock.closeAllConnections();
    await new Promise((resolve) => mock.close(resolve));
  }
};
