import type { DirectoryAccess, DirectoryGrant } from '@alune/protocol';

export const fileAccessApi = {
  available: false,
  async grants(_connectionId: string): Promise<DirectoryGrant[]> {
    throw new Error('当前连接不支持目录授权。');
  },
  async grant(
    _connectionId: string,
    _path: string,
    _access: DirectoryAccess,
  ): Promise<DirectoryGrant> {
    throw new Error('当前连接不支持目录授权。');
  },
  async revoke(_connectionId: string, _grant: DirectoryGrant): Promise<void> {
    throw new Error('当前连接不支持目录授权。');
  },
};
