// One authenticated host channel carries exactly one protocol session.
import { encodeMessage, parseMessage, ProtocolError, type RpcMessage } from '@alune/protocol';
import type { MessageTransport } from './transport';

export interface FrameChannel {
  send(frame: string): Promise<void>;
  close(): void;
  onFrame(fn: (frame: string) => void): () => void;
  onEnd(fn: () => void): () => void;
}

export function frameTransport(channel: FrameChannel): MessageTransport {
  const messages = new Set<(message: RpcMessage) => void>();
  const endings = new Set<(error: Error) => void>();
  let ended = false;
  const offFrame = channel.onFrame((frame) => {
    try {
      const message = parseMessage(frame);
      for (const fn of messages) fn(message);
    } catch (error) {
      close(error as Error);
    }
  });
  const offEnd = channel.onEnd(() => close());
  function close(
    error: Error = new ProtocolError('disconnected', 'Agent channel closed', 'unknown'),
  ) {
    if (ended) return;
    ended = true;
    offFrame();
    offEnd();
    channel.close();
    for (const fn of endings) fn(error);
    endings.clear();
    messages.clear();
  }
  return {
    async send(message) {
      if (ended) throw new ProtocolError('disconnected', 'Agent channel closed', 'unknown');
      try {
        await channel.send(encodeMessage(message));
      } catch (error) {
        close(error as Error);
        throw error;
      }
    },
    close,
    onMessage(fn) {
      messages.add(fn);
      return () => {
        messages.delete(fn);
      };
    },
    onClose(fn) {
      endings.add(fn);
      return () => {
        endings.delete(fn);
      };
    },
  };
}
