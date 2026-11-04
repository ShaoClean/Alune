import {
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import Database from 'better-sqlite3';
import {
  AccessTokensStore,
  initializeAccessTokenTables,
  tokenValue as coreTokenValue,
} from '@alune/agent/accounts';
import { SECRET_STORAGE } from '../secrets/secrets.module';
import type { SecretStorage } from '../secrets/secret-storage';
import { EventsGateway } from '../events/events.gateway';

const errors = {
  badRequest: (message: string) => new BadRequestException(message),
  conflict: (message: string) => new ConflictException(message),
  notFound: (message: string) => new NotFoundException(message),
  unavailable: (message: string) => new ServiceUnavailableException(message),
  writeFailed: (message: string) => new ServiceUnavailableException(message),
};
export const tokenValue = (value: unknown) => coreTokenValue(value, errors);
@Injectable()
export class AccessTokensService extends AccessTokensStore {
  constructor(
    @Inject('DATABASE') db: Database.Database,
    @Inject(SECRET_STORAGE) secrets: SecretStorage,
    events: EventsGateway,
  ) {
    initializeAccessTokenTables(db);
    super(
      db,
      secrets,
      () => events.server?.emit('access-tokens:changed'),
      errors,
      (error) => error instanceof HttpException,
      'legacy',
    );
  }
}
