import { StateFault } from './state';

export interface SettingsErrors {
  badRequest(message: string): Error;
  conflict(message: string): Error;
  notFound(message: string): Error;
  unavailable(message: string): Error;
  writeFailed(message: string): Error;
}
export const settingsErrors: SettingsErrors = {
  badRequest: (message) => new StateFault('invalid-input', message),
  conflict: (message) => new StateFault('conflict', message),
  notFound: (message) => new StateFault('not-found', message),
  unavailable: (message) => new StateFault('unavailable', message),
  writeFailed: (message) => new StateFault('unavailable', message, 'unknown'),
};
