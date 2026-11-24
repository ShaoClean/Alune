export type CloseMode = 'ask' | 'hide' | 'system';

export interface DesktopPreferences {
  closeMode: CloseMode;
  showTitle: boolean;
  available: boolean;
  platform: string;
}

export interface TrayTab {
  id: string;
  label: string;
  branch: string;
  revision?: number;
  offline: boolean;
  stale: boolean;
}

interface HeadRequest {
  id: string;
  request: number;
}

declare global {
  interface Window {
    aluneTray?: {
      getPreferences(): Promise<DesktopPreferences>;
      setPreferences(
        value: Partial<Pick<DesktopPreferences, 'closeMode' | 'showTitle'>>,
      ): Promise<DesktopPreferences>;
      onPreferences(fn: (value: DesktopPreferences) => void): () => void;
      publish(value: { activeId: string | null; tabs: TrayTab[] }): void;
      repositoryChanged(id: string): void;
      onSelect(fn: (id: string) => void): () => void;
      onReadHead(fn: (request: HeadRequest) => void): () => void;
      replyHead(
        value: HeadRequest & { state: 'ready' | 'offline' | 'cached'; label?: string },
      ): void;
    };
  }
}
