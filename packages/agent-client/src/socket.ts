import type { Duplex } from 'node:stream';
import { MAX_FRAME_BYTES, ProtocolError, encodeMessage, type RpcMessage } from '@alune/protocol';
import { StdioTransport } from './stdio';

export type ProxyPort = number | 'blocked' | undefined;

// Exactly 69 ASCII bytes before the normal framed stream. 00000 means no proxy.
export function socketPreface(token: string, port: ProxyPort | 'probe' | 'stop'): string {
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid daemon credential');
  if (typeof port === 'number' && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw Error('Invalid daemon proxy port');
  const suffix =
    port === 'probe'
      ? 'probe'
      : port === 'stop'
        ? 'stop!'
        : port === 'blocked'
          ? 'block'
          : String(port ?? 0).padStart(5, '0');
  return token + suffix;
}

// Four-byte big-endian length followed by exactly one UTF-8 JSON value.
class SocketDecoder {
  private header = Buffer.alloc(4);
  private payload?: Buffer;
  private used = 0;
  private utf8 = new TextDecoder('utf-8', { fatal: true });

  push(chunk: Uint8Array, accept: (frame: string) => void) {
    let offset = 0;
    while (offset < chunk.length) {
      const destination = this.payload ?? this.header;
      const count = Math.min(destination.length - this.used, chunk.length - offset);
      destination.set(chunk.subarray(offset, offset + count), this.used);
      this.used += count;
      offset += count;
      if (this.used !== destination.length) continue;
      this.used = 0;
      if (this.payload) {
        const frame = this.utf8.decode(this.payload);
        this.payload = undefined;
        accept(frame);
      } else {
        const size = this.header.readUInt32BE();
        if (!size || size > MAX_FRAME_BYTES)
          throw new ProtocolError('parse', 'Invalid daemon frame size');
        this.payload = Buffer.allocUnsafe(size);
      }
    }
  }

  end() {
    if (this.payload || this.used) throw new ProtocolError('parse', 'Truncated daemon frame');
  }
}

function encodeSocketFrame(message: RpcMessage) {
  const json = encodeMessage(message).slice(0, -1);
  const length = Buffer.byteLength(json);
  if (length > MAX_FRAME_BYTES) throw new ProtocolError('overloaded', 'Daemon frame exceeds limit');
  const buffer = Buffer.allocUnsafe(4 + length);
  buffer.writeUInt32BE(length);
  buffer.write(json, 4);
  return buffer;
}

export class SocketTransport extends StdioTransport {
  constructor(stream: Duplex, credentials?: { token: string; port: ProxyPort }) {
    super(
      stream,
      stream,
      { bytes: MAX_FRAME_BYTES + 4, messages: 128 },
      new SocketDecoder(),
      encodeSocketFrame,
    );
    if (credentials) stream.write(socketPreface(credentials.token, credentials.port));
  }
}
