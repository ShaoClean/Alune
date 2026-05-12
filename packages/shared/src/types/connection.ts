export interface SSHConnectionConfig {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey' | 'sshAgent';
  password?: string;
  privateKey?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

export interface ConnectionInfo {
  id: string;
  config: Omit<SSHConnectionConfig, 'password' | 'privateKey' | 'passphrase'>;
  status: ConnectionStatus;
  lastConnected?: Date;
  error?: string;
}