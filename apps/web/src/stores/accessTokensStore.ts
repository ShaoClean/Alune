import { create } from 'zustand';
import type { AccessTokenSettings } from '@alune/shared';
import { accessTokenApi } from '../api';
import { errorMessage } from '../components/files-tree';

export interface TokenReturnTarget {
  repositoryId: string;
  remote: string;
  target: string;
}
let request = 0;
export const useAccessTokensStore = create<{
  settings: AccessTokenSettings | null;
  error: string;
  loading: boolean;
  choice: (TokenReturnTarget & { tokenId: string }) | null;
  choose: (choice: TokenReturnTarget & { tokenId: string }) => void;
  load: () => Promise<void>;
  accept: (settings: AccessTokenSettings) => void;
}>((set) => ({
  settings: null,
  error: '',
  loading: false,
  choice: null,
  choose: (choice) => set({ choice }),
  accept: (settings) => {
    request++;
    set({ settings, error: '', loading: false });
  },
  load: async () => {
    const current = ++request;
    set({ loading: true, error: '' });
    try {
      const settings = await accessTokenApi.list();
      if (current === request) set({ settings, loading: false });
    } catch (error) {
      if (current === request)
        set({ loading: false, error: errorMessage(error, '无法读取访问令牌，请重试。') });
    }
  },
}));
