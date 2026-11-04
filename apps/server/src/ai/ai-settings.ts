import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AiSettingsStore as CoreStore,
  FileJsonDocument,
  validateModels as coreValidateModels,
} from '@alune/agent/settings';
import type { AiSecretStorage } from './secret-storage';
const errors = {
  badRequest: (m: string) => new BadRequestException(m),
  conflict: (m: string) => new ConflictException(m),
  notFound: (m: string) => new NotFoundException(m),
  unavailable: (m: string) => new ServiceUnavailableException(m),
  writeFailed: (m: string) => new ServiceUnavailableException(m),
};
export const validateModels = (value: unknown) =>
  coreValidateModels(value, errors);
export class AiSettingsStore extends CoreStore {
  constructor(file: string, secrets: AiSecretStorage) {
    super(new FileJsonDocument(file), secrets, errors);
  }
}
