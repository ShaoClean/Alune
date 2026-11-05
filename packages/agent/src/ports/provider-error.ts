// Only controlled, user-facing failures cross a provider boundary. Upstream bodies never do.
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
  get status() {
    return this.statusCode;
  }
  getStatus() {
    return this.statusCode;
  }
}
// The compatibility host can also supply its own typed service errors.
export function isProviderError(error: unknown): error is Error & { getStatus(): number } {
  return (
    error instanceof Error && typeof (error as Partial<ProviderError>).getStatus === 'function'
  );
}
export class BadRequestException extends ProviderError {
  constructor(message: string) {
    super(message, 400);
  }
}
export class ForbiddenException extends ProviderError {
  constructor(message: string) {
    super(message, 403);
  }
}
export class NotFoundException extends ProviderError {
  constructor(message: string) {
    super(message, 404);
  }
}
export class ConflictException extends ProviderError {
  constructor(message: string) {
    super(message, 409);
  }
}
export class GoneException extends ProviderError {
  constructor(message: string) {
    super(message, 410);
  }
}
export class BadGatewayException extends ProviderError {
  constructor(message: string) {
    super(message, 502);
  }
}
export class GatewayTimeoutException extends ProviderError {
  constructor(message: string) {
    super(message, 504);
  }
}
