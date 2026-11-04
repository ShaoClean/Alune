import { isRecord, ProtocolError, validateEmpty, type JsonValue } from '@alune/protocol';
import type {
  AiModel,
  CommitGenerationPreferences,
  SaveAiProvider,
  SaveNetworkProxy,
} from '@alune/protocol';
import {
  openProtectedSecrets,
  type ProtectedSecretOptions,
  type ProtectedSecrets,
} from '../adapters/secrets/protected';
import type { AgentState } from '../adapters/sqlite/state';
import type { Handler, HandlerContext } from '../ports/handler';
import { StateFault, type SecretCipher } from '../ports/state';
import { AiSettingsStore, ProxySettingsStore } from '../modules/settings';

// Owned by the state kernel; reads never initialize an OS credential record.
export function settingsKernel(
  state: AgentState,
  directory: string,
  agentId: string,
  options: Pick<ProtectedSecretOptions, 'backend' | 'keychain'> = {},
) {
  let secrets: ProtectedSecrets | undefined;
  let closed = false;
  let tail: Promise<unknown> = Promise.resolve();
  const cipher: SecretCipher = {
    get available() {
      return Boolean(secrets?.available);
    },
    get description() {
      return secrets?.description ?? '密钥存储尚未就绪；保存凭据时将初始化，已有凭据需恢复原密钥。';
    },
    encrypt(value) {
      if (!secrets) throw new StateFault('unavailable', 'Credential storage is unavailable');
      return secrets.encrypt(value);
    },
    decrypt(value) {
      if (!secrets) throw new StateFault('unavailable', 'Credential storage is unavailable');
      return secrets.decrypt(value);
    },
  };
  const ai = new AiSettingsStore(state.document('ai-settings'), cipher);
  const proxy = new ProxySettingsStore(state.document('network-proxy'), cipher);
  async function prepare(create: boolean, signal: AbortSignal) {
    if (secrets) return;
    const port = state.document('credential-key');
    if (!create && port.read() === undefined) return;
    try {
      secrets = await openProtectedSecrets(directory, agentId, port, {
        ...options,
        allowInitialize: create && !state.hasCredentialMaterial(),
        signal,
      });
    } catch (error) {
      signal.throwIfAborted();
      // Read/configuration without credentials remains usable, but writes that
      // require a key must surface the failure and never select another backend.
      if (create) throw error;
    }
  }
  function shape(params: JsonValue | undefined, required: string[], optional: string[] = []) {
    if (
      !isRecord(params) ||
      required.some((key) => !Object.hasOwn(params, key)) ||
      Object.keys(params).some((key) => !required.includes(key) && !optional.includes(key))
    )
      throw new ProtocolError('invalid-params', 'Invalid settings parameters');
  }
  function handler(
    effect: 'query' | 'mutation',
    validate: Handler['validate'],
    run: (params: any, context: HandlerContext) => unknown,
    needsKey: (params: any) => boolean = () => false,
  ): Handler {
    return {
      minimumProtocolMinor: 1,
      effect,
      validate,
      run(params, context) {
        const task = tail.then(async () => {
          if (closed) throw new StateFault('unavailable', 'Settings store is closed');
          context.signal.throwIfAborted();
          await prepare(needsKey(params), context.signal);
          context.signal.throwIfAborted();
          const result = run(params, context);
          if (effect === 'mutation')
            context.events.notifyState('settings.changed', { section: 'configuration' });
          return result as JsonValue;
        });
        tail = task.catch(() => undefined);
        return task;
      },
    };
  }
  const handlers: Record<string, Handler> = {
    'settings.credentials.prepare': handler(
      'mutation',
      validateEmpty,
      () => ({ available: cipher.available, description: cipher.description }),
      () => true,
    ),
    'settings.ai.get': handler('query', validateEmpty, () => ai.read()),
    'settings.ai.saveProvider': handler(
      'mutation',
      (p) => shape(p, ['provider', 'revision'], ['id']),
      (p) => ai.saveProvider(p.id, p.provider as SaveAiProvider, p.revision),
      (p) => typeof p.provider?.apiKey === 'string',
    ),
    'settings.ai.saveModels': handler(
      'mutation',
      (p) => shape(p, ['id', 'models', 'revision']),
      (p) => ai.saveModels(p.id, p.models as AiModel[], p.revision),
    ),
    'settings.ai.saveCommit': handler(
      'mutation',
      (p) => shape(p, ['commit', 'revision']),
      (p) => ai.saveCommit(p.commit as CommitGenerationPreferences, p.revision),
    ),
    'settings.proxy.get': handler('query', validateEmpty, () => proxy.read()),
    'settings.proxy.save': handler(
      'mutation',
      (p) => shape(p, ['config']),
      (p) => proxy.save(p.config as SaveNetworkProxy),
      (p) => p.config?.credentials?.action === 'replace',
    ),
  };
  return {
    handlers,
    ai,
    proxy,
    async close() {
      closed = true;
      await tail;
      secrets?.close();
    },
  };
}
