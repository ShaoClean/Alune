import { isRecord, ProtocolError, validId } from './messages';

export interface OpenHostRoute {
  hostId: string;
  /** Lowercase SHA-256 of the SSH host public key (wire format), supplied out of band. */
  hostKey: string;
  /** Explicitly authorize installing the locally provisioned artifact on this connection. */
  install: boolean;
}
export function validateOpenHost(v: unknown): asserts v is OpenHostRoute {
  if (
    !isRecord(v) ||
    !validId(v.hostId) ||
    typeof v.hostKey !== 'string' ||
    !/^[a-f0-9]{64}$/.test(v.hostKey) ||
    typeof v.install !== 'boolean' ||
    Object.keys(v).some((k) => !['hostId', 'hostKey', 'install'].includes(k))
  )
    throw new ProtocolError(
      'invalid-params',
      'Expected a host profile, pinned host key and install policy',
    );
}
