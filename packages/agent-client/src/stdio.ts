import type { Readable, Writable } from 'node:stream';
import {
  FrameDecoder,
  encodeMessage,
  parseMessage,
  ProtocolError,
  MAX_FRAME_BYTES,
} from '@alune/protocol';
import type { RpcMessage } from '@alune/protocol';
import type { MessageTransport } from './transport';

interface Write {
  frame: string;
  bytes: number;
  resolve(): void;
  reject(error: Error): void;
}
export class StdioTransport implements MessageTransport {
  private decoder = new FrameDecoder();
  private messages = new Set<(message: RpcMessage) => void>();
  private closures = new Set<(error: Error) => void>();
  private queue: Write[] = [];
  private bytes = 0;
  private writing = false;
  private ended?: Error;
  constructor(
    private input: Readable,
    private output: Writable,
    private limits = { bytes: MAX_FRAME_BYTES + 1, messages: 128 },
  ) {
    input.on('data', this.data);
    input.once('end', this.end);
    input.once('error', this.error);
    input.once('close', this.closed);
    output.once('error', this.error);
    output.once('close', this.closed);
  }
  private data = (chunk: Buffer | string) => {
    try {
      this.decoder.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk, (frame) => {
        if (this.ended) return;
        const message = parseMessage(frame);
        for (const listener of this.messages) listener(message);
      });
    } catch (error) {
      this.close(error as Error);
    }
  };
  private end = () => {
    try {
      this.decoder.end();
      this.close();
    } catch (error) {
      this.close(error as Error);
    }
  };
  private error = (error: Error) => this.close(error);
  private closed = () => this.close();
  onMessage(listener: (message: RpcMessage) => void): () => void {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }
  onClose(listener: (error: Error) => void): () => void {
    if (this.ended) {
      listener(this.ended);
      return () => {};
    }
    this.closures.add(listener);
    return () => this.closures.delete(listener);
  }
  send(message: RpcMessage): Promise<void> {
    if (this.ended) return Promise.reject(new ProtocolError('disconnected', 'Transport closed'));
    let frame: string;
    try {
      frame = encodeMessage(message);
    } catch (error) {
      return Promise.reject(error);
    }
    const bytes = Buffer.byteLength(frame);
    if (this.bytes + bytes > this.limits.bytes || this.queue.length >= this.limits.messages)
      return Promise.reject(new ProtocolError('overloaded', 'Transport output queue exceeded'));
    return new Promise((resolve, reject) => {
      this.bytes += bytes;
      this.queue.push({ frame, bytes, resolve, reject });
      this.pump();
    });
  }
  private pump(): void {
    if (this.writing || this.ended || !this.queue.length) return;
    this.writing = true;
    const item = this.queue[0];
    try {
      this.output.write(item.frame, (error) => {
        if (this.ended) return;
        if (error) {
          this.close(error);
          return;
        }
        this.queue.shift();
        this.bytes -= item.bytes;
        this.writing = false;
        item.resolve();
        this.pump();
      });
    } catch (error) {
      this.close(error as Error);
    }
  }
  close(error: Error = new ProtocolError('disconnected', 'Transport ended', 'unknown')): void {
    if (this.ended) return;
    // A peer may close its read pipe while state events are still being sent.
    // This is the same disconnect as EOF, not malformed protocol input.
    if (['EPIPE', 'ECONNRESET'].includes((error as NodeJS.ErrnoException).code ?? ''))
      error = new ProtocolError('disconnected', 'Peer closed the transport', 'unknown');
    this.ended = error;
    this.input.off('data', this.data);
    this.input.off('end', this.end);
    // Keep error listeners until streams are actually destroyed: EPIPE can arrive late.
    this.input.off('close', this.closed);
    this.output.off('close', this.closed);
    for (const item of this.queue)
      item.reject(new ProtocolError('disconnected', 'Output delivery interrupted', 'unknown'));
    this.queue = [];
    this.bytes = 0;
    this.output.end();
    this.input.destroy();
    for (const listener of this.closures) listener(error);
    this.closures.clear();
    this.messages.clear();
  }
}
