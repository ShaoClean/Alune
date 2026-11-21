import { isRecord, ProtocolError, validId } from './messages';

export interface OpenHostRoute {
  hostId: string;
  /** Lowercase SHA-256 of the SSH host public key, or null to trust the first key if no pin exists. */
  hostKey: string | null;
  /** Skip a system launcher that failed initialization. */
  managedOnly?: boolean;
  confirmedUpgradePid?: number;
  /** Explicitly apply this saved proxy revision to an idle route. */
  reconnectRevision?: string;
}
export function validateOpenHost(v: unknown): asserts v is OpenHostRoute {
  if (
    !isRecord(v) ||
    !validId(v.hostId) ||
    (v.hostKey !== null && (typeof v.hostKey !== 'string' || !/^[a-f0-9]{64}$/.test(v.hostKey))) ||
    (v.confirmedUpgradePid !== undefined &&
      (!Number.isSafeInteger(v.confirmedUpgradePid) || Number(v.confirmedUpgradePid) < 1)) ||
    (v.managedOnly !== undefined && typeof v.managedOnly !== 'boolean') ||
    (v.reconnectRevision !== undefined && !validId(v.reconnectRevision)) ||
    Object.keys(v).some(
      (k) =>
        !['hostId', 'hostKey', 'managedOnly', 'confirmedUpgradePid', 'reconnectRevision'].includes(
          k,
        ),
    )
  )
    throw new ProtocolError('invalid-params', 'Expected a host profile, host key policy');
}
