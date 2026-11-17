import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import * as path from 'node:path';
import {
  FILE_ACCESS_MAX_BYTES,
  ProtocolError,
  validateFileAccess,
  type DirectoryGrant,
  type DirectoryGrantRef,
} from '@alune/protocol';
import type { Handler, HandlerContext } from '../../ports/handler';

type Grant = DirectoryGrant & { session: string; dev: number; ino: number };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const denied = () =>
  new ProtocolError('permission-denied', '目录未获授权、已撤销或不属于当前连接。');
const key = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p);
const same = (a: { dev: number; ino: number }, b: { dev: number; ino: number }) =>
  a.dev === b.dev && a.ino === b.ino;
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';

/** Explicit grants belong to one authenticated Agent session. Reconnect never
 * restores authority. Paths and opened file identities are checked before I/O. */
export function fileAccessKernel(agentId: string) {
  const grants = new Map<string, Grant>();
  const writes = new Map<string, Promise<void>>();
  async function serialize<T>(target: string, run: () => Promise<T>) {
    const identity = key(target),
      previous = writes.get(identity);
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    writes.set(identity, current);
    try {
      await previous;
      return await run();
    } finally {
      release();
      if (writes.get(identity) === current) writes.delete(identity);
    }
  }
  const publicGrant = ({ id, agentId, path, access, lifetime }: Grant): DirectoryGrant => ({
    id,
    agentId,
    path,
    access,
    lifetime,
  });
  function lookup(ref: DirectoryGrantRef, c: HandlerContext, write = false) {
    c.signal.throwIfAborted();
    c.sessionSignal.throwIfAborted();
    const g = grants.get(ref.id);
    if (
      !g ||
      ref.agentId !== agentId ||
      g.session !== c.sessionId ||
      (write && g.access !== 'read-write')
    )
      throw denied();
    return g;
  }
  async function resolve(g: Grant, relative: string, c: HandlerContext, allowMissing = false) {
    if (
      path.isAbsolute(relative) ||
      relative.includes('\\') ||
      relative.includes(':') ||
      relative
        .split('/')
        .some(
          (p) =>
            p === '..' ||
            p.toLowerCase() === '.git' ||
            (process.platform === 'win32' &&
              (/[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p))),
        )
    )
      throw denied();
    const root = await fs.realpath(g.path),
      stat = await fs.stat(root);
    if (key(root) !== key(g.path) || !same(g, stat)) throw denied();
    let target = root;
    const parts = relative.split('/').filter((p) => p && p !== '.');
    for (let i = 0; i < parts.length; i++) {
      target = path.join(target, parts[i]);
      try {
        const info = await fs.lstat(target);
        if (info.isSymbolicLink() || (i < parts.length - 1 && !info.isDirectory())) throw denied();
      } catch (e) {
        if (!(allowMissing && i === parts.length - 1 && missing(e))) throw e;
      }
    }
    const parent = await fs.realpath(parts.length ? path.dirname(target) : target);
    const rel = path.relative(g.path, parent);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw denied();
    lookup(g, c);
    return target;
  }
  async function verifyHandle(
    g: Grant,
    target: string,
    handle: fs.FileHandle,
    c: HandlerContext,
    write = false,
  ) {
    // A parent swapped for a symlink between traversal and open is rejected
    // before using the handle; subsequent path changes cannot redirect it.
    const actual = await fs.realpath(target),
      rel = path.relative(g.path, actual);
    if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) throw denied();
    const [disk, opened] = await Promise.all([fs.lstat(target), handle.stat()]);
    if (
      disk.isSymbolicLink() ||
      !opened.isFile() ||
      !same(disk, opened) ||
      (write && opened.nlink !== 1)
    )
      throw denied();
    await resolve(g, path.relative(g.path, target).split(path.sep).join('/'), c);
    lookup(g, c, write);
    return opened;
  }
  async function bytes(handle: fs.FileHandle) {
    const result = Buffer.alloc(FILE_ACCESS_MAX_BYTES + 1);
    let size = 0;
    while (size < result.length) {
      const read = await handle.read(result, size, result.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    if (size > FILE_ACCESS_MAX_BYTES)
      throw new ProtocolError('invalid-params', '文本文件超过 4 MiB。');
    return result.subarray(0, size);
  }
  const handler = (
    name: string,
    effect: Handler['effect'],
    run: (p: any, c: HandlerContext) => Promise<unknown> | unknown,
  ): Handler => ({
    minimumProtocolMinor: 7,
    effect,
    validate: (p) => validateFileAccess(name, p),
    async run(p, c) {
      try {
        return JSON.parse(JSON.stringify(await run(p, c)));
      } catch (e) {
        if (e instanceof ProtocolError) throw e;
        c.signal.throwIfAborted();
        c.sessionSignal.throwIfAborted();
        throw new ProtocolError(
          missing(e) ? 'not-found' : 'unavailable',
          e instanceof Error ? e.message : '文件操作失败',
          effect === 'mutation' ? 'unknown' : 'not-started',
        );
      }
    },
  });
  const handlers: Record<string, Handler> = {
    'files.grant': handler('grant', 'mutation', async (p, c) => {
      if (!path.isAbsolute(p.path)) throw new ProtocolError('invalid-params', '请输入绝对目录。');
      const root = await fs.realpath(p.path),
        stat = await fs.stat(root);
      if (!stat.isDirectory() || root.split(/[\\/]/).some((p) => p.toLowerCase() === '.git'))
        throw denied();
      c.signal.throwIfAborted();
      c.sessionSignal.throwIfAborted();
      if (grants.size >= 64) throw new ProtocolError('overloaded', '授权目录数量已达上限。');
      const grant: Grant = {
        id: randomUUID(),
        agentId,
        path: root,
        access: p.access,
        lifetime: 'session',
        session: c.sessionId,
        dev: stat.dev,
        ino: stat.ino,
      };
      grants.set(grant.id, grant);
      return publicGrant(grant);
    }),
    'files.grants': handler('grants', 'query', (_p, c) =>
      [...grants.values()].filter((g) => g.session === c.sessionId).map(publicGrant),
    ),
    'files.revoke': handler('revoke', 'mutation', (p, c) => {
      const g = lookup(p.grant, c);
      grants.delete(g.id);
      return null;
    }),
    'files.list': handler('list', 'query', async (p, c) => {
      const g = lookup(p.grant, c),
        target = await resolve(g, p.path, c);
      const list = await fs.readdir(target, { withFileTypes: true });
      if (list.length > 10000) throw new ProtocolError('overloaded', '目录条目超过 10000。');
      await resolve(g, p.path, c);
      return list.map((e) => ({
        name: e.name,
        isFile: e.isFile(),
        isDirectory: e.isDirectory(),
        longname: e.name,
      }));
    }),
    'files.read': handler('read', 'query', async (p, c) => {
      const g = lookup(p.grant, c),
        target = await resolve(g, p.path, c);
      if (!(await fs.lstat(target)).isFile()) throw denied();
      const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        await verifyHandle(g, target, handle, c);
        const data = await bytes(handle);
        lookup(g, c);
        const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(data);
        if (content.includes('\0'))
          throw new ProtocolError('invalid-params', '文件不是可读取的文本。');
        return { content, version: hash(data) };
      } finally {
        await handle.close();
      }
    }),
    'files.write': handler('write', 'mutation', async (p, c) => {
      const data = Buffer.from(p.content, 'utf8');
      if (data.length > FILE_ACCESS_MAX_BYTES || p.content.includes('\0'))
        throw new ProtocolError('invalid-params', '请输入不超过 4 MiB 的文本。');
      const g = lookup(p.grant, c, true),
        target = await resolve(g, p.path, c, p.version === 'missing');
      if (!p.path) throw denied();
      return serialize(target, async () => {
        lookup(g, c, true);
        await resolve(g, p.path, c, p.version === 'missing');
        if (p.version !== 'missing' && !(await fs.lstat(target)).isFile()) throw denied();
        const handle = await fs.open(
          target,
          p.version === 'missing' ? 'wx+' : constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
        );
        let started = p.version === 'missing';
        try {
          await verifyHandle(g, target, handle, c, true);
          if (p.version !== 'missing' && hash(await bytes(handle)) !== p.version)
            throw new ProtocolError('conflict', '文件已变化，请重新读取后确认。');
          lookup(g, c, true);
          started = true;
          let offset = 0;
          while (offset < data.length) {
            lookup(g, c, true);
            const { bytesWritten } = await handle.write(
              data,
              offset,
              Math.min(65536, data.length - offset),
              offset,
            );
            if (!bytesWritten) throw new Error('文件写入未取得进展。');
            offset += bytesWritten;
          }
          lookup(g, c, true);
          await handle.truncate(data.length);
          await handle.sync();
          return { success: true, version: hash(data) };
        } catch (e) {
          if (started)
            throw new ProtocolError(
              'unavailable',
              '文件可能已部分写入，请重新读取核对；不会自动重放。',
              'unknown',
            );
          throw e;
        } finally {
          await handle.close();
        }
      });
    }),
  };
  return {
    handlers,
    disconnect(session: string) {
      for (const g of grants.values()) if (g.session === session) grants.delete(g.id);
    },
    close() {
      grants.clear();
    },
  };
}
