import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { JsonDocument } from '../ports/state';

/** Compatibility adapter for existing JSON configuration files. */
export class FileJsonDocument implements JsonDocument {
  constructor(private readonly file: string) {}
  read(): unknown | undefined {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw error;
    }
  }
  write(value: unknown): void {
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true, mode: 0o700 });
      writeFileSync(temporary, JSON.stringify(value), { flag: 'wx', mode: 0o600, flush: true });
      renameSync(temporary, this.file);
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
