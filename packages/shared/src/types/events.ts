export interface CommandOutputEvent {
  connectionId: string;
  repositoryId?: string;
  command: string;
  data: string;
  type: 'stdout' | 'stderr';
}

export interface CommandExitEvent {
  connectionId: string;
  repositoryId?: string;
  command: string;
  exitCode: number;
}

export interface ConnectionStatusEvent {
  connectionId: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  error?: string;
}

export interface RepositoryStatusEvent {
  repositoryId: string;
  connectionId: string;
  isDirty: boolean;
  currentBranch: string;
  ahead: number;
  behind: number;
}

export type ServerEvents = {
  'connection:status': ConnectionStatusEvent;
  'repo:status': RepositoryStatusEvent;
  'command:output': CommandOutputEvent;
  'command:exit': CommandExitEvent;
};