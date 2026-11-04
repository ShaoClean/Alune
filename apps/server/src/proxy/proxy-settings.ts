import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  ProxySettingsStore as CoreStore,
  FileJsonDocument,
} from '@alune/agent/settings';
import type { SecretStorage } from '../secrets/secret-storage';
const errors = {
  badRequest: (m: string) => new BadRequestException(m),
  conflict: (m: string) => new ConflictException(m),
  notFound: (m: string) => new NotFoundException(m),
  unavailable: (m: string) => new ServiceUnavailableException(m),
  writeFailed: (m: string) => new ServiceUnavailableException(m),
};
export class ProxySettingsStore extends CoreStore {
  constructor(file: string, secrets: SecretStorage) {
    super(new FileJsonDocument(file), secrets, errors);
  }
}
