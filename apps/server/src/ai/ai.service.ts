import { BadGatewayException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { Readable } from 'stream';

type UpstreamProtocol = 'openai' | 'anthropic';

const DEFAULT_BASE_URL = 'http://192.168.8.21:23000';
const DEFAULT_MODELS = [
  'gpt-5.5',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.3-codex',
  'gpt-5.2',
  'claude-sonnet-4-5-20250929',
  'claude-opus-4-5-20251101',
  'claude-haiku-4-5-20251001',
];

@Injectable()
export class AiService {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.normalizeBaseUrl(
      this.config.get<string>('AI_GATEWAY_BASE_URL') || DEFAULT_BASE_URL,
    );
    this.apiKey = this.config.get<string>('AI_GATEWAY_API_KEY') || '';
  }

  getPublicConfig() {
    return {
      baseUrl: this.baseUrl,
      configured: Boolean(this.apiKey),
      models: DEFAULT_MODELS,
      endpoints: {
        responses: '/v1/responses',
        chatCompletions: '/v1/chat/completions',
        messages: '/v1/messages',
        models: '/v1/models',
      },
    };
  }

  async forward(
    method: string,
    upstreamPath: string,
    protocol: UpstreamProtocol,
    req: Request,
    res: Response,
    body?: any,
  ) {
    try {
      const upstream = await fetch(this.upstreamUrl(upstreamPath), {
        method,
        headers: this.buildHeaders(protocol, req, upstreamPath),
        body: method === 'GET' ? undefined : JSON.stringify(body || {}),
      });

      this.copyResponseHeaders(upstream, res);
      res.status(upstream.status);

      if (!upstream.body) {
        res.end();
        return;
      }

      Readable.fromWeb(upstream.body as any).pipe(res);
    } catch (err: any) {
      throw new BadGatewayException(err?.message || 'AI gateway request failed');
    }
  }

  async test(body: { model?: string; prompt?: string; protocol?: 'responses' | 'messages' }) {
    const protocol = body.protocol || 'responses';
    const model = body.model || (protocol === 'messages' ? DEFAULT_MODELS[5] : DEFAULT_MODELS[0]);
    const prompt = body.prompt || 'Reply with ok only.';

    const upstreamPath = protocol === 'messages' ? '/v1/messages' : '/v1/responses';
    const payload =
      protocol === 'messages'
        ? {
            model,
            max_tokens: 256,
            messages: [{ role: 'user', content: prompt }],
          }
        : {
            model,
            input: prompt,
            max_output_tokens: 64,
          };

    const upstream = await fetch(this.upstreamUrl(upstreamPath), {
      method: 'POST',
      headers: this.buildHeaders(protocol === 'messages' ? 'anthropic' : 'openai', undefined, upstreamPath),
      body: JSON.stringify(payload),
    });
    const text = await upstream.text();
    const parsed = this.parseJson(text);

    return {
      ok: upstream.ok,
      status: upstream.status,
      model,
      protocol,
      text:
        this.extractText(parsed) ||
        this.extractError(parsed) ||
        this.extractEmptyOutputDiagnostic(parsed) ||
        (parsed ? 'Request completed; upstream returned no text output.' : text),
      raw: parsed || text,
    };
  }

  private normalizeBaseUrl(baseUrl: string) {
    return baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  private upstreamUrl(path: string) {
    return `${this.baseUrl}${path}`;
  }

  private buildHeaders(protocol: UpstreamProtocol, req?: Request, upstreamPath?: string) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };

    if (protocol === 'anthropic') {
      headers['x-api-key'] = this.apiKey;
      headers['anthropic-version'] =
        this.headerValue(req?.headers['anthropic-version']) || '2023-06-01';
      const beta = this.headerValue(req?.headers['anthropic-beta']);
      if (beta) headers['anthropic-beta'] = beta;
    } else {
      headers.authorization = `Bearer ${this.apiKey}`;
      if (upstreamPath === '/v1/responses') {
        this.addCodexCompatHeaders(headers, req);
      }
    }

    return headers;
  }

  private addCodexCompatHeaders(headers: Record<string, string>, req?: Request) {
    const requestId = this.headerValue(req?.headers['x-client-request-id']) || randomUUID();
    const sessionId = this.headerValue(req?.headers.session_id) || requestId;
    const threadId = this.headerValue(req?.headers.thread_id) || sessionId;
    const turnId = randomUUID();

    headers.accept = 'text/event-stream';
    headers.originator = 'codex-tui';
    headers['user-agent'] =
      this.headerValue(req?.headers['user-agent']) ||
      'codex-tui/0.130.0 (Mac OS 15.5.0; arm64) iTerm.app/3.6.10 (codex-tui; 0.130.0)';
    headers['x-codex-beta-features'] = 'terminal_resize_reflow';
    headers['x-codex-turn-metadata'] = JSON.stringify({
      session_id: sessionId,
      thread_id: threadId,
      thread_source: 'user',
      turn_id: turnId,
      sandbox: 'seatbelt',
      turn_started_at_unix_ms: Date.now(),
    });
    headers['x-codex-window-id'] = `${threadId}:0`;
    headers['x-client-request-id'] = requestId;
    headers.session_id = sessionId;
    headers.thread_id = threadId;
  }

  private copyResponseHeaders(upstream: globalThis.Response, res: Response) {
    for (const [key, value] of upstream.headers.entries()) {
      if (['content-encoding', 'content-length', 'transfer-encoding'].includes(key)) continue;
      res.setHeader(key, value);
    }
  }

  private headerValue(value: string | string[] | undefined) {
    if (Array.isArray(value)) return value[0];
    return value;
  }

  private parseJson(text: string) {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  private extractText(payload: any): string {
    if (!payload) return '';
    if (typeof payload.output_text === 'string') return payload.output_text;
    if (typeof payload.completion === 'string') return payload.completion;
    if (typeof payload.content?.[0]?.text === 'string') return payload.content[0].text;
    if (typeof payload.choices?.[0]?.message?.content === 'string') {
      return payload.choices[0].message.content;
    }
    const textItems = payload.output?.flatMap((item: any) => item.content || []) || [];
    return textItems
      .map((item: any) => item.text)
      .filter(Boolean)
      .join('\n');
  }

  private extractError(payload: any): string {
    if (typeof payload?.error?.message === 'string') return payload.error.message;
    return '';
  }

  private extractEmptyOutputDiagnostic(payload: any): string {
    if (!payload) return '';
    const output = Array.isArray(payload.output) ? payload.output : null;
    if (payload.status === 'completed' && output?.length === 0) {
      const outputTokens = payload.usage?.output_tokens;
      const reasoningTokens = payload.usage?.output_tokens_details?.reasoning_tokens;
      const tokenSummary =
        typeof outputTokens === 'number'
          ? ` output_tokens=${outputTokens}, reasoning_tokens=${reasoningTokens ?? 'unknown'}.`
          : '';
      return `Upstream completed the request but returned no visible output items.${tokenSummary}`;
    }
    if (payload.status === 'incomplete' && payload.incomplete_details?.reason) {
      return `Upstream response was incomplete: ${payload.incomplete_details.reason}.`;
    }
    return '';
  }
}
