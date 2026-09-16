import { BadGatewayException, HttpException } from '@nestjs/common';
import type { AiModel, AiProvider } from '@remote-git/shared';

const RESPONSE_MAX_BYTES = 1024 * 1024;

// Never expose upstream bodies, URLs or request headers in errors: proxies can echo keys.
async function request(
  provider: AiProvider,
  key: string,
  path: string,
  signal: AbortSignal,
  body?: object,
): Promise<any> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (provider.protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (key) headers['x-api-key'] = key;
  } else if (provider.protocol === 'gemini') {
    if (key) headers['x-goog-api-key'] = key;
  } else if (key) headers.Authorization = `Bearer ${key}`;
  try {
    const response = await fetch(`${provider.baseUrl}/${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal,
      redirect: 'error',
    });
    if (!response.ok) {
      await response.body?.cancel();
      const message =
        response.status === 401 || response.status === 403
          ? 'AI 服务认证失败，请检查 API Key 及模型访问权限。'
          : response.status === 429
            ? 'AI 服务请求过于频繁或额度不足，请稍后重试。'
            : response.status === 423
              ? 'AI 服务或网关拒绝了请求（HTTP 423），请检查服务状态、账号权限及网关访问规则。'
              : response.status === 404
                ? 'AI 服务接口或模型不存在，请检查基础地址及模型 ID；也可以手动添加模型。'
                : `AI 服务暂时无法完成请求（HTTP ${response.status}），请稍后重试。`;
      throw new HttpException(message, 502);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new BadGatewayException('AI 服务返回了空响应。');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > RESPONSE_MAX_BYTES)
          throw new BadGatewayException(
            'AI 响应超过大小限制，请缩小响应或手动添加模型。',
          );
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch {
      throw new BadGatewayException(
        'AI 服务未返回有效 JSON，请检查接口协议与地址。',
      );
    }
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof HttpException) throw error;
    throw new BadGatewayException(
      '无法连接 AI 服务，请检查网络、API 地址与 TLS 证书。',
    );
  }
}

export async function complete(
  provider: AiProvider,
  key: string,
  model: string,
  system: string,
  user: string,
  signal: AbortSignal,
): Promise<string> {
  let content: unknown;
  if (provider.protocol === 'anthropic') {
    const result = await request(provider, key, 'messages', signal, {
      model,
      max_tokens: 2048,
      system,
      messages: [{ role: 'user', content: user }],
    });
    if (result.stop_reason === 'max_tokens')
      throw new BadGatewayException('AI 输出被截断，请重试或缩小暂存范围。');
    content = result.content
      ?.filter((part: any) => part.type === 'text')
      .map((part: any) => part.text)
      .join('');
  } else if (provider.protocol === 'gemini') {
    const result = await request(
      provider,
      key,
      `models/${encodeURIComponent(model.replace(/^models\//, ''))}:generateContent`,
      signal,
      {
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: 4096 },
      },
    );
    if (result.candidates?.[0]?.finishReason === 'MAX_TOKENS')
      throw new BadGatewayException('AI 输出被截断，请重试或缩小暂存范围。');
    content = result.candidates?.[0]?.content?.parts
      ?.filter((part: any) => !part.thought)
      .map((part: any) => part.text || '')
      .join('');
  } else {
    // Chat Completions also supports user-configured OpenAI-compatible services.
    const result = await request(provider, key, 'chat/completions', signal, {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
    });
    if (result.choices?.[0]?.finish_reason === 'length')
      throw new BadGatewayException('AI 输出被截断，请重试或缩小暂存范围。');
    content = result.choices?.[0]?.message?.content;
  }
  if (typeof content !== 'string' || !content.trim())
    throw new BadGatewayException(
      'AI 服务未返回文本，可能被内容策略拦截。请检查模型后重试。',
    );
  return content.trim();
}

export async function fetchModels(
  provider: AiProvider,
  key: string,
  signal: AbortSignal,
): Promise<AiModel[]> {
  const models = new Map<string, AiModel>();
  let cursor = '';
  const cursors = new Set<string>();
  for (let page = 0; page < 10; page++) {
    const suffix =
      provider.protocol === 'gemini'
        ? `?pageSize=1000${cursor ? `&pageToken=${encodeURIComponent(cursor)}` : ''}`
        : provider.protocol === 'anthropic'
          ? `?limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ''}`
          : '';
    const result = await request(provider, key, `models${suffix}`, signal);
    const list = provider.protocol === 'gemini' ? result.models : result.data;
    if (!Array.isArray(list))
      throw new BadGatewayException(
        '服务未提供可识别的模型列表，请手动添加准确模型 ID。',
      );
    for (const item of list) {
      if (
        provider.protocol === 'gemini' &&
        Array.isArray(item.supportedGenerationMethods) &&
        !item.supportedGenerationMethods.includes('generateContent')
      )
        continue;
      const id =
        provider.protocol === 'gemini'
          ? item.name?.replace(/^models\//, '')
          : item.id;
      if (typeof id !== 'string' || !id || id.length > 200 || /\s|\0/.test(id))
        continue;
      const label = item.displayName || item.display_name || id;
      models.set(id, {
        id,
        name: typeof label === 'string' ? label.slice(0, 200) : id,
        enabled: false,
      });
      if (models.size > 1000)
        throw new BadGatewayException(
          '模型列表超过 1000 个，请手动添加需要的模型。',
        );
    }
    cursor =
      provider.protocol === 'gemini'
        ? result.nextPageToken
        : provider.protocol === 'anthropic' && result.has_more
          ? result.last_id
          : '';
    if (!cursor) {
      if (!models.size)
        throw new BadGatewayException(
          '没有获取到可用模型，请手动添加准确模型 ID。',
        );
      return [...models.values()];
    }
    if (typeof cursor !== 'string' || cursors.has(cursor)) break;
    cursors.add(cursor);
  }
  throw new BadGatewayException(
    '模型列表分页未完成，原有列表已保留，请手动添加模型。',
  );
}

export function parseCommit(content: string): {
  message: string;
  description: string;
} {
  let parsed: any;
  try {
    parsed = JSON.parse(
      content.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1'),
    );
  } catch {
    throw new BadGatewayException(
      'AI 未返回有效的提交摘要与描述，请重试或调整模型及提示词。',
    );
  }
  if (
    typeof parsed?.message !== 'string' ||
    !parsed.message.trim() ||
    /[\r\n\0]/.test(parsed.message) ||
    parsed.message.length > 200 ||
    typeof parsed.description !== 'string' ||
    parsed.description.length > 12000 ||
    parsed.description.includes('\0')
  ) {
    throw new BadGatewayException(
      'AI 返回的提交摘要或描述为空、过长或格式无效，请重试。',
    );
  }
  return {
    message: parsed.message.trim(),
    description: parsed.description.trim(),
  };
}
