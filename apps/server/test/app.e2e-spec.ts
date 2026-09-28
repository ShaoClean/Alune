import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  let directory: string;
  const previousDirectory = process.env.ALUNE_DATA_DIR;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), 'alune-app-e2e-'));
    process.env.ALUNE_DATA_DIR = directory;
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule.register()],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
    app.get('DATABASE').close();
    rmSync(directory, { recursive: true, force: true });
    if (previousDirectory === undefined) delete process.env.ALUNE_DATA_DIR;
    else process.env.ALUNE_DATA_DIR = previousDirectory;
  });
});
