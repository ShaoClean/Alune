import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import Database from 'better-sqlite3';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  constructor(@Inject('DATABASE') private db: Database.Database) {}

  get database(): Database.Database {
    return this.db;
  }

  onModuleDestroy() {
    this.db.close();
  }

  run(sql: string, ...params: any[]) {
    return this.db.prepare(sql).run(...params);
  }

  get<T = any>(sql: string, ...params: any[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T = any>(sql: string, ...params: any[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
}