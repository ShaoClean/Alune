import { Module, Global } from '@nestjs/common';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

@Global()
@Module({
  providers: [
    {
      provide: 'DATABASE',
      useFactory: () => {
        const dbDir = process.env.REMOTE_GIT_DATA_DIR || path.join(os.homedir(), '.remote-git');
        fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
        const db = new Database(path.join(dbDir, 'remote-git.db'));
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        return db;
      },
    },
  ],
  exports: ['DATABASE'],
})
export class DatabaseModule {}
