import { isRecord, ProtocolError, validId } from './messages';
export type HostAuthType = 'password' | 'privateKey' | 'sshAgent';
export interface HostProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: HostAuthType;
  privateKeyPath: string | null;
  hasPassword: boolean;
  hasPassphrase: boolean;
  createdAt: string;
  updatedAt: string;
}
export type SaveHostProfile = Pick<
  HostProfile,
  'name' | 'host' | 'port' | 'username' | 'authType' | 'privateKeyPath'
> & {
  password?: string | null;
  passphrase?: string | null;
};
export interface HostProfilesResult {
  revision: string;
  hosts: HostProfile[];
  secretStorage: { available: boolean; description: string };
}
export function validateHostProfiles(value: unknown): HostProfilesResult {
  if (
    !isRecord(value) ||
    !validId(value.revision) ||
    !Array.isArray(value.hosts) ||
    !isRecord(value.secretStorage) ||
    typeof value.secretStorage.available !== 'boolean' ||
    typeof value.secretStorage.description !== 'string'
  )
    throw new ProtocolError('invalid-request', 'Invalid host profile list');
  for (const host of value.hosts) {
    if (
      !isRecord(host) ||
      !validId(host.id) ||
      typeof host.name !== 'string' ||
      typeof host.host !== 'string' ||
      !Number.isInteger(host.port) ||
      Number(host.port) < 1 ||
      Number(host.port) > 65535 ||
      typeof host.username !== 'string' ||
      !['password', 'privateKey', 'sshAgent'].includes(host.authType as string) ||
      (host.privateKeyPath !== null && typeof host.privateKeyPath !== 'string') ||
      typeof host.hasPassword !== 'boolean' ||
      typeof host.hasPassphrase !== 'boolean' ||
      typeof host.createdAt !== 'string' ||
      typeof host.updatedAt !== 'string' ||
      Object.keys(host).some(
        (key) =>
          ![
            'id',
            'name',
            'host',
            'port',
            'username',
            'authType',
            'privateKeyPath',
            'hasPassword',
            'hasPassphrase',
            'createdAt',
            'updatedAt',
          ].includes(key),
      )
    )
      throw new ProtocolError('invalid-request', 'Invalid host profile');
  }
  return value as unknown as HostProfilesResult;
}
