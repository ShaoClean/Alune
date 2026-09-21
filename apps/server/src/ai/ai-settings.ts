import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type {
  AiModel,
  AiProvider,
  AiSettings,
  CommitGenerationPreferences,
  SaveAiProvider,
} from '@alune/shared';
import type { AiSecretStorage } from './secret-storage';

type StoredProvider = Omit<AiProvider, 'hasApiKey'> & { encryptedKey?: string };
type StoredSettings = {
  revision: string;
  providers: StoredProvider[];
  commit: CommitGenerationPreferences;
};

const defaults = (): StoredSettings => ({
  revision: randomUUID(),
  providers: [
    ['openai', 'OpenAI', 'openai', 'https://api.openai.com/v1', 'gpt-4.1-mini'],
    [
      'anthropic',
      'Anthropic',
      'anthropic',
      'https://api.anthropic.com/v1',
      'claude-sonnet-4-5',
    ],
    [
      'gemini',
      'Gemini',
      'gemini',
      'https://generativelanguage.googleapis.com/v1beta',
      'gemini-2.5-flash',
    ],
    [
      'deepseek',
      'DeepSeek',
      'openai',
      'https://api.deepseek.com/v1',
      'deepseek-chat',
    ],
  ].map(([id, name, protocol, baseUrl, model]) => ({
    id,
    name,
    protocol: protocol as AiProvider['protocol'],
    baseUrl,
    enabled: false,
    builtin: true,
    models: [{ id: model, name: model, enabled: true }],
  })),
  commit: {
    providerId: null,
    modelId: null,
    language: 'zh-CN',
    format: 'conventional',
    prompt: '',
  },
});

function text(
  value: unknown,
  name: string,
  max: number,
  empty = false,
): string {
  if (
    typeof value !== 'string' ||
    (!empty && !value.trim()) ||
    value.length > max ||
    value.includes('\0')
  ) {
    throw new BadRequestException(`${name}无效（最多 ${max} 个字符）。`);
  }
  return value.trim();
}

export function validateModels(value: unknown): AiModel[] {
  if (!Array.isArray(value) || value.length > 1000)
    throw new BadRequestException('最多配置 1000 个模型。');
  const ids = new Set<string>();
  return value.map((model) => {
    const id = text(model?.id, '模型 ID', 200);
    if (/\s/.test(id) || ids.has(id) || typeof model.enabled !== 'boolean')
      throw new BadRequestException('模型 ID 重复或无效。');
    ids.add(id);
    return {
      id,
      name: text(model.name || id, '模型名称', 200),
      enabled: model.enabled,
    };
  });
}

export class AiSettingsStore {
  private data: StoredSettings;
  private loadError: string | null = null;

  constructor(
    private file: string,
    readonly secrets: AiSecretStorage,
  ) {
    try {
      this.data = JSON.parse(readFileSync(file, 'utf8'));
      if (
        !Array.isArray(this.data.providers) ||
        !this.data.commit ||
        !this.data.revision
      )
        throw new Error();
      for (const provider of this.data.providers) {
        text(provider.id, '服务商 ID', 80);
        text(provider.name, '服务商名称', 80);
        text(provider.baseUrl, 'API 地址', 2048);
        validateModels(provider.models);
        if (
          !['openai', 'anthropic', 'gemini'].includes(provider.protocol) ||
          typeof provider.enabled !== 'boolean'
        )
          throw new Error();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.loadError = 'AI 配置文件无法读取，请恢复有效配置文件后重启。';
      }
      this.data = defaults();
    }
  }

  read(): AiSettings {
    this.assertReadable();
    const { revision, commit } = this.data;
    return structuredClone({
      revision,
      commit: {
        providerId: commit.providerId,
        modelId: commit.modelId,
        language: commit.language,
        format: commit.format,
        prompt: commit.prompt,
      },
      providers: this.data.providers.map((provider) => ({
        id: provider.id,
        name: provider.name,
        protocol: provider.protocol,
        baseUrl: provider.baseUrl,
        enabled: provider.enabled,
        builtin: provider.builtin,
        hasApiKey: Boolean(provider.encryptedKey),
        models: provider.models.map((model) => ({
          id: model.id,
          name: model.name,
          enabled: model.enabled,
        })),
      })),
      secretStorage: {
        available: this.secrets.available,
        description: this.secrets.description,
      },
    });
  }

  assertRevision(revision: string) {
    this.assertReadable();
    if (revision !== this.data.revision)
      throw new ConflictException('AI 配置已变化，请重新加载后重试。');
  }

  private assertReadable() {
    // A damaged AI settings file must not stop the Git workspace from starting.
    if (this.loadError) throw new ServiceUnavailableException(this.loadError);
  }

  provider(id: string): AiProvider {
    const provider = this.read().providers.find((item) => item.id === id);
    if (!provider) throw new NotFoundException('服务商不存在。');
    return provider;
  }

  key(id: string): string {
    this.assertReadable();
    const provider = this.data.providers.find((item) => item.id === id);
    if (!provider) throw new NotFoundException('服务商不存在。');
    if (!provider.encryptedKey) return '';
    try {
      const value = JSON.parse(this.secrets.decrypt(provider.encryptedKey));
      if (value.id !== id || typeof value.key !== 'string') throw new Error();
      return value.key;
    } catch {
      throw new ServiceUnavailableException(
        '无法解密此服务商的密钥，请恢复本机密钥存储或重新保存 API Key。',
      );
    }
  }

  saveProvider(
    id: string | undefined,
    input: SaveAiProvider,
    revision: string,
  ): AiSettings {
    this.assertRevision(revision);
    const previous = id
      ? this.data.providers.find((item) => item.id === id)
      : undefined;
    if (id && !previous) throw new NotFoundException('服务商不存在。');
    if (
      !input ||
      !['openai', 'anthropic', 'gemini'].includes(input.protocol) ||
      typeof input.enabled !== 'boolean'
    ) {
      throw new BadRequestException('请选择有效的接口协议及启用状态。');
    }
    if (previous?.builtin && previous.protocol !== input.protocol)
      throw new BadRequestException('预置服务商的协议不可修改。');
    const name = text(input.name, '服务商名称', 80);
    const baseUrl = text(input.baseUrl, 'API 地址', 2048).replace(/\/+$/, '');
    try {
      const url = new URL(baseUrl);
      if (
        !['https:', 'http:'].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error();
    } catch {
      throw new BadRequestException(
        'API 地址必须是 HTTP(S) 基础地址，不能包含认证信息、查询参数或片段。',
      );
    }
    const models = validateModels(input.models);
    if (
      previous?.encryptedKey &&
      input.apiKey === undefined &&
      (baseUrl !== previous.baseUrl || input.protocol !== previous.protocol)
    ) {
      throw new BadRequestException(
        '更改接口地址或协议时，请重新输入 API Key 或清除原密钥。',
      );
    }
    const providerId = id || randomUUID();
    let encryptedKey = previous?.encryptedKey;
    if (input.apiKey === null) encryptedKey = undefined;
    else if (input.apiKey !== undefined) {
      const key = text(input.apiKey, 'API Key', 8192);
      if (/[\r\n]/.test(key))
        throw new BadRequestException('API Key 不能包含换行。');
      if (!this.secrets.available)
        throw new ServiceUnavailableException(this.secrets.description);
      try {
        encryptedKey = this.secrets.encrypt(
          JSON.stringify({ id: providerId, key }),
        );
      } catch {
        throw new ServiceUnavailableException(
          '无法保护 API Key，配置未保存。请检查本机密钥存储。',
        );
      }
    }
    const provider: StoredProvider = {
      id: providerId,
      name,
      protocol: input.protocol,
      baseUrl,
      enabled: input.enabled,
      builtin: previous?.builtin || false,
      models,
      encryptedKey,
    };
    const next = structuredClone(this.data);
    next.providers = previous
      ? next.providers.map((item) => (item.id === providerId ? provider : item))
      : [...next.providers, provider];
    if (next.providers.length > 100)
      throw new BadRequestException('最多配置 100 个服务商。');
    this.persist(next);
    return this.read();
  }

  saveModels(id: string, models: AiModel[], revision: string): AiSettings {
    const provider = this.provider(id);
    return this.saveProvider(id, { ...provider, models }, revision);
  }

  saveCommit(input: CommitGenerationPreferences, revision: string): AiSettings {
    this.assertRevision(revision);
    if (
      !input ||
      !['zh-CN', 'en'].includes(input.language) ||
      !['conventional', 'natural'].includes(input.format)
    ) {
      throw new BadRequestException('提交生成设置无效。');
    }
    const prompt = text(input.prompt, '补充提示词', 4000, true);
    const providerId = input.providerId || null;
    const modelId = input.modelId || null;
    if (providerId || modelId) {
      const provider = this.provider(providerId!);
      if (
        !provider.enabled ||
        !provider.models.some((m) => m.id === modelId && m.enabled)
      )
        throw new BadRequestException('请选择已启用的服务商和模型。');
    }
    this.persist({
      ...this.data,
      commit: {
        providerId,
        modelId,
        language: input.language,
        format: input.format,
        prompt,
      },
    });
    return this.read();
  }

  private persist(next: StoredSettings) {
    const provider = next.providers.find(
      (p) => p.id === next.commit.providerId && p.enabled,
    );
    if (
      !provider?.models.some((m) => m.id === next.commit.modelId && m.enabled)
    ) {
      next.commit = { ...next.commit, providerId: null, modelId: null };
    }
    next.revision = randomUUID();
    const temp = `${this.file}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(temp, JSON.stringify(next), { mode: 0o600, flag: 'wx' });
      renameSync(temp, this.file);
    } catch {
      throw new ServiceUnavailableException(
        'AI 配置保存失败，请检查本机数据目录权限。',
      );
    } finally {
      rmSync(temp, { force: true });
    }
    this.data = next;
  }
}
