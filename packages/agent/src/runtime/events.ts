import {
  parseEvent,
  ProtocolError,
  MAX_EVENT_QUEUE_BYTES,
  MAX_EVENT_QUEUE_LENGTH,
  MAX_STREAM_CHUNK_BYTES,
} from '@alune/protocol';
import type { AgentEvent, JsonValue, RpcNotification } from '@alune/protocol';
import type { ResourceRef } from '@alune/domain';

interface Item {
  event: Omit<AgentEvent, 'sequence'>;
  bytes: number;
  reliable: boolean;
  resolve?(): void;
  reject?(error: Error): void;
  cleanup?(): void;
}
export class EventQueue {
  private queue: Item[] = [];
  private inFlight?: Item & { sequence: number };
  private bytes = 0;
  private sequence = 0;
  private lastAck = 0;
  private resync = false;
  private lastWasResync = false;
  private timer?: ReturnType<typeof setTimeout>;
  private topics = new Set<string>();
  private ended?: Error;
  constructor(
    private agentId: string,
    private sessionId: string,
    private send: (message: RpcNotification) => Promise<void>,
    private fatal: (error: Error) => void,
    private limits = {
      bytes: MAX_EVENT_QUEUE_BYTES,
      messages: MAX_EVENT_QUEUE_LENGTH,
      ackMs: 30000,
    },
    private hostSequence?: { value: number },
  ) {
    this.sequence = hostSequence?.value ?? 0;
    this.resync = this.sequence > 0;
    if (limits.bytes < 2048 || limits.messages < 2 || limits.ackMs <= 0)
      throw new Error('Event queue limits are too small');
  }
  subscribe(topics: string[]): void {
    this.topics = new Set(topics);
  }
  subscribed(type: string): boolean {
    return this.topics.has('*') || this.topics.has(type);
  }
  private item(
    type: string,
    payload: JsonValue,
    resource: ResourceRef | undefined,
    reliable: boolean,
  ): Item {
    const event = {
      agentId: this.agentId,
      sessionId: this.sessionId,
      sequence: 1,
      type,
      payload,
      ...(resource ? { resource } : {}),
    };
    // Serialize once to take ownership (including nested payload data). The
    // sender validates the outer RPC envelope when it assigns the sequence.
    parseEvent(event);
    const encoded = JSON.stringify(event);
    const bytes = Buffer.byteLength(encoded) + 100; // outer notification and eventual sequence digits
    if (bytes > MAX_STREAM_CHUNK_BYTES || bytes > this.limits.bytes)
      throw new ProtocolError('invalid-params', 'Event must be split into bounded chunks');
    const copy = parseEvent(JSON.parse(encoded));
    const { sequence: _, ...owned } = copy;
    return { event: owned, bytes, reliable };
  }
  notifyState(type: string, payload: JsonValue, resource?: ResourceRef): void {
    if (this.ended || !this.subscribed(type)) return;
    const item = this.item(type, payload, resource, false);
    const index = this.queue.findIndex(
      (old) =>
        !old.reliable &&
        old.event.type === type &&
        old.event.resource?.resourceId === resource?.resourceId,
    );
    if (index >= 0) {
      this.bytes -= this.queue.splice(index, 1)[0].bytes;
      this.resync = true;
    }
    if (!this.fits(item)) {
      this.resync = true;
      this.queue = this.queue.filter((old) => {
        if (!old.reliable) this.bytes -= old.bytes;
        return old.reliable;
      });
    }
    if (this.fits(item)) {
      this.queue.push(item);
      this.bytes += item.bytes;
    }
    this.pump();
  }
  write(
    type: string,
    payload: JsonValue,
    resource?: ResourceRef,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.ended) return Promise.reject(this.ended);
    if (signal?.aborted)
      return Promise.reject(new ProtocolError('cancelled', 'Stream write cancelled'));
    if (!this.subscribed(type))
      return Promise.reject(
        new ProtocolError('invalid-params', 'Subscribe before writing a reliable stream'),
      );
    let item: Item;
    try {
      item = this.item(type, payload, resource, true);
    } catch (error) {
      return Promise.reject(error);
    }
    if (!this.fits(item))
      return Promise.reject(
        new ProtocolError('overloaded', 'Event queue full; await acknowledgements'),
      );
    return new Promise((resolve, reject) => {
      item.resolve = resolve;
      item.reject = reject;
      const cancel = () => {
        const index = this.queue.indexOf(item);
        if (index >= 0) {
          this.queue.splice(index, 1);
          this.bytes -= item.bytes;
        }
        item.cleanup?.();
        reject(
          new ProtocolError(
            'cancelled',
            'Stream write cancelled',
            this.inFlight === item ? 'unknown' : 'not-started',
          ),
        );
      };
      item.cleanup = () => signal?.removeEventListener('abort', cancel);
      signal?.addEventListener('abort', cancel, { once: true });
      this.queue.push(item);
      this.bytes += item.bytes;
      this.pump();
    });
  }
  private fits(item: Item): boolean {
    // Reserve one small control packet for resync, even at full data capacity.
    return (
      this.bytes + item.bytes <= this.limits.bytes - 1024 &&
      this.queue.length + Number(Boolean(this.inFlight)) < this.limits.messages - 1
    );
  }
  ack(sequence: number): void {
    if (sequence <= this.lastAck) return;
    if (!this.inFlight || sequence !== this.inFlight.sequence)
      throw new ProtocolError(
        'invalid-params',
        'Acknowledgement does not match the in-flight event',
      );
    clearTimeout(this.timer);
    this.lastAck = sequence;
    this.bytes -= this.inFlight.bytes;
    this.inFlight.cleanup?.();
    this.inFlight.resolve?.();
    this.inFlight = undefined;
    this.pump();
  }
  private pump(): void {
    if (this.inFlight || this.ended) return;
    let item: Item | undefined;
    if (this.resync && (!this.lastWasResync || !this.queue.length)) {
      item = this.item(
        'events.resync-required',
        { reason: 'state-coalesced-or-overflowed' },
        undefined,
        false,
      );
      this.resync = false;
      this.lastWasResync = true;
      this.bytes += item.bytes;
    } else {
      item = this.queue.shift();
      this.lastWasResync = false;
    }
    if (!item) return;
    const sequence = ++this.sequence;
    if (this.hostSequence) this.hostSequence.value = Math.max(this.hostSequence.value, sequence);
    this.inFlight = Object.assign(item, { sequence });
    this.timer = setTimeout(
      () => this.fail(new ProtocolError('timeout', 'Event acknowledgement timed out', 'unknown')),
      this.limits.ackMs,
    );
    void this.send({
      jsonrpc: '2.0',
      method: 'agent.event',
      params: { ...item.event, sequence } as unknown as JsonValue,
    }).catch((error) => this.fail(error));
  }
  failStream(error: Error): void {
    if (!this.ended) this.fail(error);
  }
  private fail(error: Error): void {
    this.close(error);
    this.fatal(error);
  }
  close(error: Error = new ProtocolError('disconnected', 'Event session closed', 'unknown')): void {
    if (this.ended) return;
    this.ended = error;
    clearTimeout(this.timer);
    this.inFlight?.cleanup?.();
    this.inFlight?.reject?.(error);
    for (const item of this.queue) {
      item.cleanup?.();
      item.reject?.(error);
    }
    this.queue = [];
    this.inFlight = undefined;
    this.bytes = 0;
  }
  get bufferedBytes(): number {
    return this.bytes;
  }
  get bufferedMessages(): number {
    return this.queue.length + Number(Boolean(this.inFlight));
  }
}
