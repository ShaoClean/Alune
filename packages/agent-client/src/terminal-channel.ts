// The authenticated host supplies the socket. Frames use the same validation
// as stdio; a new socket always gets a new protocol session.
import { encodeMessage, parseMessage, ProtocolError, type RpcMessage } from '@alune/protocol';
import type { MessageTransport } from './transport';
interface Channel {
  connected: boolean;
  on(name: string, listener: (...args: any[]) => void): unknown;
  off(name: string, listener: (...args: any[]) => void): unknown;
  emit(name: string, frame: string): unknown;
  disconnect(): unknown;
}
export function terminalChannel(socket: Channel): MessageTransport {
  const messages = new Set<(message: RpcMessage) => void>();
  const endings = new Set<(error: Error) => void>();
  let ended = false;
  const incoming = (frame: unknown) => {
    try {
      if (typeof frame !== 'string')
        throw new ProtocolError('invalid-request', 'Expected terminal frame');
      const m = parseMessage(frame);
      for (const fn of messages) fn(m);
    } catch (error) {
      close(error as Error);
    }
  };
  function close(
    error = new ProtocolError('disconnected', 'Terminal channel closed', 'unknown') as Error,
  ) {
    if (ended) return;
    ended = true;
    socket.off('terminal:rpc', incoming);
    socket.off('disconnect', disconnected);
    for (const fn of endings) fn(error);
    endings.clear();
    messages.clear();
    if (socket.connected) socket.disconnect();
  }
  const disconnected = () => close();
  socket.on('terminal:rpc', incoming);
  socket.on('disconnect', disconnected);
  return {
    async send(m) {
      if (ended || !socket.connected)
        throw new ProtocolError('disconnected', 'Terminal channel closed');
      socket.emit('terminal:rpc', encodeMessage(m));
    },
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
    close,
  };
}
