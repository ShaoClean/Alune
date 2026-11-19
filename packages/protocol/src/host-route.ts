import { isRecord, ProtocolError, validId } from './messages';

export interface OpenHostRoute {
  hostId: string;
  /** Lowercase SHA-256 of the SSH host public key, or null to trust the first key if no pin exists. */
  hostKey: string | null;
  /** Explicitly authorize installing the locally provisioned artifact on this connection. */
  install: boolean;
  /** Explicitly apply this saved proxy revision to an idle route. */
  reconnectRevision?: string;
}
export function validateOpenHost(v: unknown): asserts v is OpenHostRoute {
  if (
    !isRecord(v) ||
    !validId(v.hostId) ||
    (v.hostKey !== null && (typeof v.hostKey !== 'string' || !/^[a-f0-9]{64}$/.test(v.hostKey))) ||
    typeof v.install !== 'boolean' ||
    (v.reconnectRevision !== undefined && !validId(v.reconnectRevision)) ||
    Object.keys(v).some((k) => !['hostId', 'hostKey', 'install', 'reconnectRevision'].includes(k))
  )
    throw new ProtocolError(
      'invalid-params',
      'Expected a host profile, host key policy and install policy',
    );
}
