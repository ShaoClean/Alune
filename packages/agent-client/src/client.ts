import { validateCollaboration, type CollaborationMethods } from '@alune/protocol';
import type {
  AccessTokenSettings,
  AgentEvent,
  AiModel,
  AiSettings,
  CapabilitiesResult,
  CommitGenerationPreferences,
  CredentialStorageStatus,
  DatabaseBackupReceipt,
  HealthResult,
  HostProfilesResult,
  InitializeResult,
  JsonValue,
  LogEntry,
  LogSettingsResult,
  NetworkProxyConfig,
  RpcMessage,
  RpcRequest,
  SaveAccessToken,
  SaveAiProvider,
  SaveHostProfile,
  SaveLoggingSettings,
  SaveNetworkProxy,
  StorageStatus,
  SubscriptionResult,
  TaskQuery,
  TaskResult,
  UpdaterBridge,
  VersionResult,
} from '@alune/protocol';
import {
  isRecord,
  isOperationId,
  validateWriteIntent,
  type RepositoryWriteKind,
  type RepositoryWriteIntent,
  type RepositoryWriteRequest,
  encodeMessage,
  MAX_EVENT_QUEUE_BYTES,
  MAX_EVENT_QUEUE_LENGTH,
  parseEvent,
  PROTOCOL_VERSION,
  ProtocolError,
  REPOSITORY_CHUNK_BYTES,
  validateAccessTokenSettings,
  validateAiSettings,
  validateCapabilities,
  validateCredentialStorageStatus,
  validateDatabaseBackupReceipt,
  validateHealth,
  validateHostProfiles,
  validateInitialized,
  validateLogChunk,
  validateLogEntries,
  validateLogSettingsResult,
  validateLogSnapshot,
  validateProxySettings,
  validateRepositoryQuery,
  validateRepositoryReceipt,
  validateRepositoryResource,
  validateRepositoryValue,
  validateStorageStatus,
  validateSubscription,
  validateTaskQuery,
  validateTaskResult,
  validateUpdaterBridge,
  validateVersion,
  type RepositoryQueryKind,
  type RepositoryQueryMap,
  type RepositoryQueryResult,
  type RepositoryResource,
  type ResourceRef,
} from '@alune/protocol';
import type { MessageTransport } from './transport';

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}
export interface RequestHandle {
  requestId: string;
  result: Promise<JsonValue>;
}
interface Pending {
  resolve(value: JsonValue): void;
  reject(error: Error): void;
  cleanup(): void;
}
export class AgentClient {
  private nextId = 0;
  private prefix = globalThis.crypto.randomUUID();
  private pending = new Map<string, Pending>();
  private retired = new Set<string>();
  private disposers: Array<() => void>;
  private eventListeners = new Set<(event: AgentEvent) => void | Promise<void>>();
  private closeListeners = new Set<(error: Error) => void>();
  private eventQueue: Array<{ event: AgentEvent; bytes: number }> = [];
  private eventBytes = 0;
  private processingEvents = false;
  private sequence = 0;
  private acknowledged = 0;
  private ended?: Error;
  private initializing?: Promise<InitializeResult>;
  private identity?: InitializeResult;

  constructor(private transport: MessageTransport) {
    this.disposers = [
      transport.onMessage((message) => this.receive(message)),
      transport.onClose((error) => this.finish(error)),
    ];
  }
  get state(): 'new' | 'initializing' | 'ready' | 'closed' {
    return this.ended
      ? 'closed'
      : this.identity
        ? 'ready'
        : this.initializing
          ? 'initializing'
          : 'new';
  }
  get initialized(): InitializeResult | undefined {
    return this.identity;
  }
  initialize(client = { name: 'alune-client', version: '0.0.1' }): Promise<InitializeResult> {
    if (this.ended) return Promise.reject(new ProtocolError('disconnected', 'Connection closed'));
    if (this.initializing) return this.initializing;
    this.initializing = this.send('initialize', { protocol: { ...PROTOCOL_VERSION }, client }, {})
      .then((value) => {
        const identity = validateInitialized(value);
        if (this.ended) throw this.ended;
        this.identity = identity;
        return identity;
      })
      .catch((error) => {
        this.close(error);
        throw error;
      });
    return this.initializing;
  }
  request(method: string, params?: JsonValue, options: RequestOptions = {}): Promise<JsonValue> {
    return this.startRequest(method, params, options).result;
  }
  startRequest(method: string, params?: JsonValue, options: RequestOptions = {}): RequestHandle {
    const requestId = `${this.prefix}:${++this.nextId}`;
    if (!this.identity)
      return {
        requestId,
        result: Promise.reject(new ProtocolError('not-initialized', 'Initialize first')),
      };
    if (!this.identity.capabilities.includes(method))
      return {
        requestId,
        result: Promise.reject(
          new ProtocolError('unknown-method', `Capability unavailable: ${method}`),
        ),
      };
    return { requestId, result: this.send(method, params, options, requestId) };
  }
  private decode<T>(result: Promise<JsonValue>, validate: (value: unknown) => T): Promise<T> {
    return result.then((value) => {
      try {
        return validate(value);
      } catch (error) {
        this.close(error as Error);
        throw error;
      }
    });
  }
  collaboration<K extends keyof CollaborationMethods>(
    method: K,
    params: CollaborationMethods[K][0],
    options: RequestOptions = {},
  ): Promise<CollaborationMethods[K][1]> {
    validateCollaboration(method, params);
    if ('resource' in params && this.identity && params.resource.agentId !== this.identity.agentId)
      return Promise.reject(new ProtocolError('not-found', 'Repository belongs to another Agent'));
    return this.request(method, params as unknown as JsonValue, {
      timeoutMs: 90_000,
      ...options,
    }).then((value) => {
      if (method === 'reviews.applyToken') validateAccessTokenSettings(value);
      if (method === 'ai.models') validateAiSettings(value);
      return value as unknown as CollaborationMethods[K][1];
    });
  }
  health(): Promise<HealthResult> {
    return this.decode(this.request('agent.health'), (value) => {
      const result = validateHealth(value);
      if (
        result.agentId !== this.identity?.agentId ||
        result.sessionId !== this.identity?.sessionId
      )
        throw new ProtocolError('invalid-request', 'Health response belongs to another session');
      return result;
    });
  }
  version(): Promise<VersionResult> {
    return this.decode(this.request('agent.version'), validateVersion);
  }
  capabilities(): Promise<CapabilitiesResult> {
    return this.decode(this.request('agent.capabilities'), validateCapabilities);
  }
  subscribe(topics: string[] = ['*']): Promise<SubscriptionResult> {
    return this.decode(this.request('events.subscribe', { topics }), (value) => {
      const result = validateSubscription(value);
      if (result.sessionId !== this.identity?.sessionId)
        throw new ProtocolError('invalid-request', 'Subscription belongs to another session');
      return result;
    });
  }
  getTask(query: TaskQuery): Promise<TaskResult> {
    try {
      validateTaskQuery(query);
    } catch (error) {
      return Promise.reject(error);
    }
    const params: Record<string, JsonValue> = {};
    if (query.requestId !== undefined) params.requestId = query.requestId;
    else params.taskId = query.taskId!;
    return this.decode(this.request('tasks.get', params), validateTaskResult);
  }
  prepareCredentials(options: RequestOptions = {}): Promise<CredentialStorageStatus> {
    return this.decode(
      this.request('settings.credentials.prepare', undefined, options),
      validateCredentialStorageStatus,
    );
  }
  getAiSettings(options: RequestOptions = {}): Promise<AiSettings> {
    return this.decode(this.request('settings.ai.get', undefined, options), validateAiSettings);
  }
  saveAiProvider(
    id: string | undefined,
    provider: SaveAiProvider,
    revision: string,
    options: RequestOptions = {},
  ): Promise<AiSettings> {
    // The settings form uses undefined to keep a stored secret and null to
    // clear it. Only the latter is a field on the JSON wire.
    const { apiKey, ...fields } = provider;
    const payload = apiKey === undefined ? fields : { ...fields, apiKey };
    return this.decode(
      this.request(
        'settings.ai.saveProvider',
        { ...(id === undefined ? {} : { id }), provider: payload, revision } as unknown as JsonValue,
        options,
      ),
      validateAiSettings,
    );
  }
  saveAiModels(
    id: string,
    models: AiModel[],
    revision: string,
    options: RequestOptions = {},
  ): Promise<AiSettings> {
    return this.decode(
      this.request(
        'settings.ai.saveModels',
        { id, models, revision } as unknown as JsonValue,
        options,
      ),
      validateAiSettings,
    );
  }
  saveCommitPreferences(
    commit: CommitGenerationPreferences,
    revision: string,
    options: RequestOptions = {},
  ): Promise<AiSettings> {
    return this.decode(
      this.request('settings.ai.saveCommit', { commit, revision } as unknown as JsonValue, options),
      validateAiSettings,
    );
  }
  getProxySettings(options: RequestOptions = {}): Promise<NetworkProxyConfig> {
    return this.decode(
      this.request('settings.proxy.get', undefined, options),
      validateProxySettings,
    );
  }
  saveProxySettings(
    config: SaveNetworkProxy,
    options: RequestOptions = {},
  ): Promise<NetworkProxyConfig> {
    return this.decode(
      this.request('settings.proxy.save', { config } as unknown as JsonValue, options),
      validateProxySettings,
    );
  }
  listAccessTokens(options: RequestOptions = {}): Promise<AccessTokenSettings> {
    return this.decode(
      this.request('accounts.tokens.list', undefined, options),
      validateAccessTokenSettings,
    );
  }
  saveAccessToken(
    id: string | null,
    input: SaveAccessToken,
    options: RequestOptions = {},
  ): Promise<AccessTokenSettings> {
    return this.decode(
      this.request('accounts.tokens.save', { id, input } as unknown as JsonValue, options),
      validateAccessTokenSettings,
    );
  }
  deleteAccessToken(
    id: string,
    revision: string,
    options: RequestOptions = {},
  ): Promise<AccessTokenSettings> {
    return this.decode(
      this.request('accounts.tokens.delete', { id, revision }, options),
      validateAccessTokenSettings,
    );
  }
  getLoggingSettings(options: RequestOptions = {}): Promise<LogSettingsResult> {
    return this.decode(
      this.request('diagnostics.logs.settings', undefined, options),
      validateLogSettingsResult,
    );
  }
  saveLoggingSettings(
    settings: SaveLoggingSettings,
    revision: string,
    options: RequestOptions = {},
  ): Promise<LogSettingsResult> {
    return this.decode(
      this.request(
        'diagnostics.logs.saveSettings',
        { settings, revision } as unknown as JsonValue,
        options,
      ),
      validateLogSettingsResult,
    );
  }
  async repositoryAnalytics(
    resources: ResourceRef[],
    collect = false,
    refresh = false,
    options?: RequestOptions,
  ): Promise<
    Array<{
      id: string;
      resource: ResourceRef;
      data?: RepositoryQueryResult<'analytics'>;
      error?: string;
    }>
  > {
    const value = await this.request(
      'repositories.analytics',
      { resources, collect, refresh } as unknown as JsonValue,
      { timeoutMs: 220000, ...options },
    );
    if (!Array.isArray(value))
      throw new ProtocolError('invalid-request', 'Invalid analytics batch response');
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry))
        throw new ProtocolError('invalid-request', 'Invalid analytics entry');
      const found = resources.find((r) => r.resourceId === entry.id);
      if (
        !found ||
        !entry.resource ||
        typeof entry.resource !== 'object' ||
        Array.isArray(entry.resource) ||
        entry.resource.agentId !== found.agentId ||
        entry.resource.resourceId !== found.resourceId
      )
        throw new ProtocolError('invalid-request', 'Analytics resource mismatch');
      return {
        id: found.resourceId,
        resource: found,
        ...(entry.data ? { data: validateRepositoryValue('analytics', entry.data) } : {}),
        ...(typeof entry.error === 'string' ? { error: entry.error } : {}),
      };
    });
  }
  private repositoryResult(value: unknown, expected?: ResourceRef): RepositoryResource {
    const repository = validateRepositoryResource(value);
    if (
      repository.resource.agentId !== this.identity?.agentId ||
      (expected &&
        (repository.resource.agentId !== expected.agentId ||
          repository.resource.resourceId !== expected.resourceId))
    )
      throw new ProtocolError('invalid-request', 'Repository response identity mismatch');
    return repository;
  }
  async listRepositories(options?: RequestOptions): Promise<RepositoryResource[]> {
    return this.decode(this.request('repositories.list', undefined, options), (value) => {
      if (!Array.isArray(value))
        throw new ProtocolError('invalid-request', 'Invalid repository catalog');
      return value.map((entry) => this.repositoryResult(entry));
    });
  }
  getRepository(resource: ResourceRef, options?: RequestOptions): Promise<RepositoryResource> {
    return this.decode(
      this.request('repositories.get', { resource } as unknown as JsonValue, options),
      (value) => this.repositoryResult(value, resource),
    );
  }
  unregisterRepository(resource: ResourceRef, options?: RequestOptions): Promise<JsonValue> {
    return this.request('repositories.unregister', { resource } as unknown as JsonValue, options);
  }
  registerRepository(path: string, options?: RequestOptions): Promise<RepositoryResource> {
    return this.decode(this.request('repositories.register', { path }, options), (value) =>
      this.repositoryResult(value),
    );
  }
  inspectRepository(path: string, options?: RequestOptions): Promise<JsonValue> {
    return this.request('repositories.inspect', { path }, options);
  }
  discoverRepositories(path: string, depth = 4, options?: RequestOptions): Promise<JsonValue> {
    return this.request('repositories.discover', { path, depth }, options);
  }
  pinRepository(
    resource: ResourceRef,
    pinned: boolean,
    options?: RequestOptions,
  ): Promise<RepositoryResource> {
    return this.decode(
      this.request('repositories.pin', { resource, pinned } as unknown as JsonValue, options),
      (value) => this.repositoryResult(value, resource),
    );
  }
  openRelatedRepository(
    resource: ResourceRef,
    path: string,
    kind: 'worktree' | 'submodule',
    options?: RequestOptions,
  ): Promise<RepositoryResource> {
    return this.decode(
      this.request(
        'repositories.openRelated',
        { resource, path, kind } as unknown as JsonValue,
        options,
      ),
      (value) => this.repositoryResult(value),
    );
  }
  invalidateRepository(resource: ResourceRef, options?: RequestOptions): Promise<JsonValue> {
    return this.request('repositories.invalidate', { resource } as unknown as JsonValue, options);
  }
  async prepareRepositoryWrite<K extends RepositoryWriteKind>(
    intent: RepositoryWriteIntent<K>,
    options?: RequestOptions,
  ): Promise<string> {
    const body = JSON.parse(JSON.stringify(intent));
    validateWriteIntent(body);
    return this.decode(
      this.request('repositories.prepareWrite', body, { timeoutMs: 125000, ...options }),
      (value) => {
        if (
          !isRecord(value) ||
          typeof value.revision !== 'string' ||
          !/^[a-f0-9]{64}$/.test(value.revision)
        )
          throw new ProtocolError('invalid-request', 'Invalid write revision');
        return value.revision;
      },
    );
  }
  writeRepository<K extends RepositoryWriteKind>(
    request: RepositoryWriteRequest<K>,
    options?: RequestOptions,
  ): Promise<JsonValue> {
    const body = JSON.parse(JSON.stringify(request));
    validateWriteIntent(body, true);
    return this.request('repositories.write', body, { timeoutMs: 310000, ...options });
  }
  repositoryOperation(resource: ResourceRef) {
    return this.decode(
      this.request('repositories.operation', { resource } as unknown as JsonValue),
      (value) => {
        if (value === null) return null;
        if (
          !isRecord(value) ||
          !isOperationId(value.operationId) ||
          typeof value.kind !== 'string' ||
          typeof value.startedAt !== 'number' ||
          typeof value.cancelling !== 'boolean'
        )
          throw new ProtocolError('invalid-request', 'Invalid active operation');
        return { ...value, operationId: value.operationId };
      },
    );
  }
  cancelRepositoryWrite(resource: ResourceRef, operationId: string) {
    return this.request('repositories.cancelWrite', {
      resource,
      operationId,
    } as unknown as JsonValue);
  }
  async readRepository<K extends RepositoryQueryKind>(
    resource: ResourceRef,
    kind: K,
    params: RepositoryQueryMap[K]['params'],
    options: RequestOptions = {},
  ): Promise<RepositoryQueryResult<K>> {
    params = JSON.parse(JSON.stringify(params));
    validateRepositoryQuery({ resource, kind, params });
    const receipt = await this.decode(
      this.request('repositories.read', { resource, kind, params } as unknown as JsonValue, {
        timeoutMs: 125000,
        ...options,
      }),
      validateRepositoryReceipt,
    );
    if (
      receipt.resource.agentId !== resource.agentId ||
      receipt.resource.resourceId !== resource.resourceId ||
      receipt.kind !== kind
    )
      throw new ProtocolError('invalid-request', 'Repository response identity mismatch');
    let value: unknown;
    if ('value' in receipt) value = receipt.value;
    else {
      try {
        const bytes = new Uint8Array(receipt.bytes);
        let offset = 0;
        for (let index = 0; index < receipt.chunks; index++) {
          const chunk = await this.decode(
            this.request('repositories.chunk', { snapshotId: receipt.snapshotId, index }, options),
            validateLogChunk,
          );
          if (chunk.snapshotId !== receipt.snapshotId || chunk.index !== index)
            throw new ProtocolError('invalid-request', 'Repository chunk identity mismatch');
          const decoded = globalThis.atob(chunk.base64);
          if (
            decoded.length !== Math.min(REPOSITORY_CHUNK_BYTES, receipt.bytes - offset) ||
            globalThis.btoa(decoded) !== chunk.base64
          )
            throw new ProtocolError('invalid-request', 'Invalid repository chunk encoding');
          for (let n = 0; n < decoded.length; n++) bytes[offset++] = decoded.charCodeAt(n);
        }
        value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } finally {
        await this.request(
          'repositories.release',
          { snapshotId: receipt.snapshotId },
          { timeoutMs: 1000 },
        ).catch(() => {});
      }
    }
    return validateRepositoryValue(kind, value);
  }

  async recentLogs(limit = 1000, options: RequestOptions = {}): Promise<LogEntry[]> {
    const snapshot = await this.decode(
      this.request('diagnostics.logs.snapshot', { limit }, options),
      validateLogSnapshot,
    );
    try {
      const bytes = new Uint8Array(snapshot.bytes);
      let offset = 0;
      for (let index = 0; index < snapshot.chunks; index++) {
        const chunk = await this.decode(
          this.request(
            'diagnostics.logs.chunk',
            { snapshotId: snapshot.snapshotId, index },
            options,
          ),
          validateLogChunk,
        );
        if (chunk.snapshotId !== snapshot.snapshotId || chunk.index !== index)
          throw new ProtocolError('invalid-request', 'Log chunk belongs to another snapshot');
        const decoded = globalThis.atob(chunk.base64);
        const expected = Math.min(32768, snapshot.bytes - offset);
        if (decoded.length !== expected || globalThis.btoa(decoded) !== chunk.base64)
          throw new ProtocolError('invalid-request', 'Invalid log chunk size or encoding');
        for (let n = 0; n < decoded.length; n++) bytes[offset++] = decoded.charCodeAt(n);
      }
      const entries = validateLogEntries(
        JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
      );
      if (entries.length !== snapshot.entries)
        throw new ProtocolError('invalid-request', 'Log snapshot count does not match');
      return entries;
    } finally {
      // Releasing the immutable snapshot is safe even after read cancellation.
      await this.request(
        'diagnostics.logs.release',
        { snapshotId: snapshot.snapshotId },
        { timeoutMs: 1000 },
      ).catch(() => {});
    }
  }
  updaterBridge(options: RequestOptions = {}): Promise<UpdaterBridge> {
    return this.decode(this.request('network.updaterBridge', undefined, options), (value) => {
      const bridge = validateUpdaterBridge(value);
      if (bridge.agentId !== this.identity?.agentId)
        throw new ProtocolError('invalid-request', 'Updater bridge belongs to another Agent');
      return bridge;
    });
  }
  listHostProfiles(options: RequestOptions = {}): Promise<HostProfilesResult> {
    return this.decode(
      this.request('accounts.hosts.list', undefined, options),
      validateHostProfiles,
    );
  }
  saveHostProfile(
    id: string | null,
    profile: SaveHostProfile,
    revision: string,
    options: RequestOptions = {},
  ): Promise<HostProfilesResult> {
    return this.decode(
      this.request(
        'accounts.hosts.save',
        { id, profile, revision } as unknown as JsonValue,
        options,
      ),
      validateHostProfiles,
    );
  }
  deleteHostProfile(
    id: string,
    revision: string,
    options: RequestOptions = {},
  ): Promise<HostProfilesResult> {
    return this.decode(
      this.request('accounts.hosts.delete', { id, revision }, options),
      validateHostProfiles,
    );
  }
  storageStatus(): Promise<StorageStatus> {
    return this.decode(this.request('storage.status'), (value) => {
      const result = validateStorageStatus(value);
      if (result.agentId !== this.identity?.agentId)
        throw new ProtocolError('invalid-request', 'Storage belongs to another Agent');
      return result;
    });
  }
  backupDatabase(options: RequestOptions = {}): Promise<DatabaseBackupReceipt> {
    return this.decode(this.request('storage.backupDatabase', undefined, options), (value) => {
      const result = validateDatabaseBackupReceipt(value);
      if (result.agentId !== this.identity?.agentId)
        throw new ProtocolError('invalid-request', 'Backup belongs to another Agent');
      return result;
    });
  }
  onEvent(listener: (event: AgentEvent) => void | Promise<void>): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }
  onClose(listener: (error: Error) => void): () => void {
    if (this.ended) {
      listener(this.ended);
      return () => {};
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
  close(error: Error = new ProtocolError('disconnected', 'Client closed', 'unknown')): void {
    this.finish(error);
    this.transport.close(error);
  }
  private send(
    method: string,
    params: JsonValue | undefined,
    options: RequestOptions,
    id = `${this.prefix}:${++this.nextId}`,
  ): Promise<JsonValue> {
    if (this.ended) return Promise.reject(new ProtocolError('disconnected', 'Connection closed'));
    if (options.signal?.aborted)
      return Promise.reject(new ProtocolError('cancelled', 'Cancelled before send'));
    if (this.pending.size >= 128)
      return Promise.reject(new ProtocolError('overloaded', 'Too many pending requests'));
    const timeoutMs = options.timeoutMs ?? 30000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647)
      return Promise.reject(new ProtocolError('invalid-params', 'Invalid request timeout'));
    const request: RpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    try {
      encodeMessage(request);
    } catch (error) {
      return Promise.reject(error);
    }
    return new Promise((resolve, reject) => {
      const cancel = () => {
        if (!this.pending.has(id)) return;
        // Cancellation is only a request. Await the real result or deadline.
        void this.transport
          .send({ jsonrpc: '2.0', method: '$/cancelRequest', params: { requestId: id } })
          .catch(() =>
            this.close(
              new ProtocolError('disconnected', 'Cancellation delivery failed', 'unknown'),
            ),
          );
      };
      const timer = setTimeout(() => {
        cancel();
        this.settle(
          id,
          new ProtocolError(
            'timeout',
            'Request deadline exceeded; outcome may be unknown',
            'unknown',
          ),
        );
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', cancel);
      };
      this.pending.set(id, { resolve, reject, cleanup });
      options.signal?.addEventListener('abort', cancel, { once: true });
      void this.transport.send(request).catch((error: Error) => this.settle(id, error));
    });
  }
  private settle(id: string, error?: Error, value?: JsonValue): void {
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    pending.cleanup();
    this.retired.add(id);
    if (this.retired.size > 1024) this.retired.delete(this.retired.values().next().value!);
    if (error) pending.reject(error);
    else pending.resolve(value!);
  }
  private receive(message: RpcMessage): void {
    if (this.ended) return;
    try {
      if ('method' in message) {
        if ('id' in message || message.method !== 'agent.event')
          throw new ProtocolError('invalid-request', 'Unexpected server request');
        const event = parseEvent(message.params);
        if (
          !this.identity ||
          event.agentId !== this.identity.agentId ||
          event.sessionId !== this.identity.sessionId
        )
          throw new ProtocolError('invalid-request', 'Event belongs to another session');
        if (event.sequence <= this.sequence) {
          if (event.sequence <= this.acknowledged)
            void this.transport
              .send({
                jsonrpc: '2.0',
                method: 'events.ack',
                params: { sessionId: event.sessionId, sequence: event.sequence },
              })
              .catch((error) => this.close(error));
          return; // Duplicate events are never delivered to consumers twice.
        }
        if (event.sequence !== this.sequence + 1 && event.type !== 'events.resync-required')
          throw new ProtocolError('invalid-request', 'Event sequence gap without resync');
        const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
        if (
          this.eventBytes + bytes > MAX_EVENT_QUEUE_BYTES ||
          this.eventQueue.length >= MAX_EVENT_QUEUE_LENGTH
        )
          throw new ProtocolError('overloaded', 'Client event queue exceeded');
        this.sequence = event.sequence;
        this.eventBytes += bytes;
        this.eventQueue.push({ event, bytes });
        void this.drainEvents();
      } else {
        const id = message.id;
        if (id === null) {
          if ('error' in message)
            throw new ProtocolError(message.error.data.kind, message.error.message, 'unknown');
          throw new ProtocolError('invalid-request', 'Result response needs an ID');
        }
        if (!this.pending.has(id)) {
          if (this.retired.has(id)) return;
          throw new ProtocolError('invalid-request', 'Response has an unknown request ID');
        }
        if ('error' in message)
          this.settle(
            id,
            new ProtocolError(
              message.error.data.kind,
              message.error.message,
              message.error.data.outcome,
              message.error.data.details,
            ),
          );
        else this.settle(id, undefined, message.result);
      }
    } catch (error) {
      this.close(error as Error);
    }
  }
  private async drainEvents(): Promise<void> {
    if (this.processingEvents) return;
    this.processingEvents = true;
    try {
      while (this.eventQueue.length && !this.ended) {
        const item = this.eventQueue[0];
        for (const listener of [...this.eventListeners]) await listener(item.event);
        if (this.ended) break;
        await this.transport.send({
          jsonrpc: '2.0',
          method: 'events.ack',
          params: {
            sessionId: item.event.sessionId,
            sequence: item.event.sequence,
          },
        });
        this.acknowledged = item.event.sequence;
        this.eventQueue.shift();
        this.eventBytes -= item.bytes;
      }
    } catch (error) {
      this.close(error as Error);
    } finally {
      this.processingEvents = false;
    }
  }
  private finish(error: Error): void {
    if (this.ended) return;
    this.ended = error;
    for (const id of this.pending.keys())
      this.settle(
        id,
        !this.identity && error instanceof ProtocolError
          ? error
          : new ProtocolError(
              'disconnected',
              'Connection lost; request outcome is unknown',
              'unknown',
            ),
      );
    this.eventQueue = [];
    this.eventBytes = 0;
    for (const dispose of this.disposers ?? []) dispose();
    for (const listener of [...this.closeListeners]) {
      try {
        listener(error);
      } catch {
        /* Observer errors cannot prevent cleanup. */
      }
    }
    this.closeListeners.clear();
    this.eventListeners.clear();
  }
}
