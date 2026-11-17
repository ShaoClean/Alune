import { MAX_FRAME_BYTES, ProtocolError } from './messages';

// Amortized growth avoids one object per byte when a peer fragments a frame.
export class FrameDecoder {
  private buffer = new Uint8Array(8192);
  private length = 0;
  private decoder = new TextDecoder('utf-8', { fatal: true });
  push(chunk: Uint8Array, accept: (frame: string) => void): void {
    let start = 0;
    for (let i = 0; i <= chunk.length; i++) {
      if (i < chunk.length && chunk[i] !== 10) continue;
      const part = chunk.subarray(start, i);
      if (this.length + part.length > MAX_FRAME_BYTES)
        throw new ProtocolError('invalid-request', 'Protocol frame exceeds byte limit');
      if (this.length + part.length > this.buffer.length) {
        const next = new Uint8Array(
          Math.min(MAX_FRAME_BYTES, Math.max(this.buffer.length * 2, this.length + part.length)),
        );
        next.set(this.buffer.subarray(0, this.length));
        this.buffer = next;
      }
      this.buffer.set(part, this.length);
      this.length += part.length;
      if (i < chunk.length) {
        let frame: string;
        try {
          frame = this.decoder.decode(this.buffer.subarray(0, this.length));
        } catch {
          throw new ProtocolError('parse', 'Invalid UTF-8 frame');
        }
        this.length = 0;
        accept(frame);
      }
      start = i + 1;
    }
  }
  end(): void {
    if (this.length) throw new ProtocolError('parse', 'Truncated protocol frame');
  }
}
