export type AiProtocol = 'openai' | 'anthropic' | 'gemini';

export interface AiModel {
  id: string;
  name: string;
  enabled: boolean;
}

export interface AiProvider {
  id: string;
  name: string;
  protocol: AiProtocol;
  baseUrl: string;
  enabled: boolean;
  builtin: boolean;
  hasApiKey: boolean;
  models: AiModel[];
}

export interface CommitGenerationPreferences {
  providerId: string | null;
  modelId: string | null;
  language: 'zh-CN' | 'en';
  format: 'conventional' | 'natural';
  prompt: string;
}

export interface AiSettings {
  revision: string;
  providers: AiProvider[];
  commit: CommitGenerationPreferences;
  secretStorage: { available: boolean; description: string };
}

export type SaveAiProvider = Pick<
  AiProvider,
  'name' | 'protocol' | 'baseUrl' | 'enabled' | 'models'
> & {
  /** Omit to keep the existing key; null explicitly removes it. Never returned by read APIs. */
  apiKey?: string | null;
};

export interface TestAiProvider {
  revision: string;
  /** A saved model ID, null for the model list endpoint, or omitted for automatic selection. */
  modelId?: string | null;
}

export interface GeneratedCommit {
  message: string;
  description: string;
  stagedRevision: string;
  configRevision: string;
  modelId: string;
}
