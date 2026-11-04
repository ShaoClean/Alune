export type StateFaultKind =
  | 'busy'
  | 'corrupt'
  | 'conflict'
  | 'permission'
  | 'unavailable'
  | 'invalid-input'
  | 'not-found';
export class StateFault extends Error {
  constructor(
    readonly kind: StateFaultKind,
    message: string,
    readonly outcome: 'not-started' | 'completed' | 'unknown' = 'not-started',
  ) {
    super(message);
    this.name = 'StateFault';
  }
}

// Stored documents may contain ciphertext. This is an internal port, never an RPC result.
export interface JsonDocument {
  read(): unknown | undefined;
  write(value: unknown): void;
}

export interface SecretCipher {
  readonly available: boolean;
  readonly description: string;
  encrypt(value: string): string;
  decrypt(value: string): string;
}
