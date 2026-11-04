export type StateFaultKind = 'busy' | 'corrupt' | 'conflict' | 'permission' | 'unavailable';
export class StateFault extends Error {
  constructor(
    readonly kind: StateFaultKind,
    message: string,
  ) {
    super(message);
    this.name = 'StateFault';
  }
}

// Stored documents may contain ciphertext. This is an internal port, never an RPC result.
export interface JsonDocument {
  read(): unknown | null;
  write(value: unknown): void;
}

export interface SecretCipher {
  readonly available: boolean;
  readonly description: string;
  encrypt(value: string): string;
  decrypt(value: string): string;
}
