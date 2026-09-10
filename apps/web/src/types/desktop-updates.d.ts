export interface UpdateState {
  revision: number;
  status: 'idle' | 'checking' | 'not-available' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'error';
  currentVersion: string;
  latestVersion: string | null;
  platform: string;
  installMode: 'restart';
  supported: boolean;
  releaseNotes: string;
  background: boolean;
  progress: { percent: number; transferred: number; total: number; bytesPerSecond: number } | null;
  error: { action: 'check' | 'download' | 'install' | 'open'; message: string } | null;
}

export interface DesktopUpdates {
  getState(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  cancel(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  openFile(): Promise<UpdateState>;
  revealFile(): Promise<UpdateState>;
  subscribe(callback: (state: UpdateState) => void): () => void;
}

declare global {
  interface Window { desktopUpdates?: DesktopUpdates; }
}
