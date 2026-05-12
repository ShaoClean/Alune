import { Module, Global } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const DB_DIR = path.join(os.homedir(), '.remote-git');
const DB_PATH = path.join(DB_DIR, 'remote-git.db');

@Global()
@Module({
  providers: [
    {
      provide: 'DATABASE',
      useFactory: () => {
        fs.mkdirSync(DB_DIR, { recursive: true });
        const db = new Database(DB_PATH);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        return db;
      },
    },
  ],
  exports: ['DATABASE'],
})
export class DatabaseModule {}
