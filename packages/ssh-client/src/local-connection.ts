import { NativeRepositoryConnection } from '@alune/agent/native-repository';
import type { SFTPWrapper } from 'ssh2';

export class LocalConnection extends NativeRepositoryConnection {
  withSftp<T>(operation: (files: SFTPWrapper) => Promise<T>): Promise<T> {
    return super.withSftp((files) => operation(files as SFTPWrapper));
  }
}
