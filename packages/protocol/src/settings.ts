import { isRecord, ProtocolError } from './messages';
import type { AiModel, AiSettings, CommitGenerationPreferences } from './legacy/ai';
import type { NetworkProxyConfig } from './legacy/proxy';

export type CredentialStorageStatus = { available: boolean; description: string };
const text = (value: unknown, max: number, empty = false): value is string =>
  typeof value === 'string' &&
  value.length <= max &&
  (empty || value.length > 0) &&
  !value.includes('\0');
function fields(value: unknown, keys: string[]): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
function invalid(): never {
  throw new ProtocolError('invalid-request', 'Invalid settings response');
}
export function validateCredentialStorageStatus(value: unknown): CredentialStorageStatus {
  if (
    !fields(value, ['available', 'description']) ||
    typeof value.available !== 'boolean' ||
    !text(value.description, 4096)
  )
    invalid();
  return value as CredentialStorageStatus;
}
function model(value: unknown): value is AiModel {
  return (
    fields(value, ['id', 'name', 'enabled']) &&
    text(value.id, 200) &&
    text(value.name, 200) &&
    typeof value.enabled === 'boolean'
  );
}
function commit(value: unknown): value is CommitGenerationPreferences {
  return (
    fields(value, ['providerId', 'modelId', 'language', 'format', 'prompt']) &&
    (value.providerId === null || text(value.providerId, 80)) &&
    (value.modelId === null || text(value.modelId, 200)) &&
    ['zh-CN', 'en'].includes(value.language as string) &&
    ['conventional', 'natural'].includes(value.format as string) &&
    text(value.prompt, 4000, true)
  );
}
export function validateAiSettings(value: unknown): AiSettings {
  if (
    !fields(value, ['revision', 'providers', 'commit', 'secretStorage']) ||
    !text(value.revision, 128) ||
    !commit(value.commit) ||
    !Array.isArray(value.providers) ||
    value.providers.length > 100
  )
    invalid();
  validateCredentialStorageStatus(value.secretStorage);
  const ids = new Set<string>();
  for (const provider of value.providers) {
    if (
      !fields(provider, [
        'id',
        'name',
        'protocol',
        'baseUrl',
        'enabled',
        'builtin',
        'hasApiKey',
        'models',
      ]) ||
      !text(provider.id, 80) ||
      ids.has(provider.id) ||
      !text(provider.name, 80) ||
      !['openai', 'anthropic', 'gemini'].includes(provider.protocol as string) ||
      !text(provider.baseUrl, 2048) ||
      typeof provider.enabled !== 'boolean' ||
      typeof provider.builtin !== 'boolean' ||
      typeof provider.hasApiKey !== 'boolean' ||
      !Array.isArray(provider.models) ||
      provider.models.length > 1000 ||
      !provider.models.every(model) ||
      new Set(provider.models.map((m) => m.id)).size !== provider.models.length
    )
      invalid();
    ids.add(provider.id);
  }
  return value as unknown as AiSettings;
}
export function validateProxySettings(value: unknown): NetworkProxyConfig {
  if (
    !fields(value, [
      'revision',
      'enabled',
      'protocol',
      'host',
      'port',
      'authEnabled',
      'hasCredentials',
      'secretStorageAvailable',
    ]) ||
    !text(value.revision, 128) ||
    typeof value.enabled !== 'boolean' ||
    !['http', 'https', 'socks5'].includes(value.protocol as string) ||
    !text(value.host, 253, true) ||
    !Number.isInteger(value.port) ||
    Number(value.port) < 1 ||
    Number(value.port) > 65535 ||
    typeof value.authEnabled !== 'boolean' ||
    typeof value.hasCredentials !== 'boolean' ||
    typeof value.secretStorageAvailable !== 'boolean'
  )
    invalid();
  return value as unknown as NetworkProxyConfig;
}
