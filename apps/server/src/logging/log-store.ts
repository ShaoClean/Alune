// Legacy HTTP shell delegates to the Agent-owned logging implementation.
export {
  LogStore,
  LogValidationError,
  validateLoggingSettings,
  assertWritableDirectory,
} from '@alune/agent/logging';
