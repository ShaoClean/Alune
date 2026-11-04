import type { RpcMessage } from '@alune/protocol';

export interface MessageTransport {
  send(message: RpcMessage): Promise<void>;
  onMessage(listener: (message: RpcMessage) => void): () => void;
  onClose(listener: (error: Error) => void): () => void;
  close(error?: Error): void;
}
