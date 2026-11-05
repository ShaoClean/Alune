import { ConflictException, Global, Injectable, Module } from '@nestjs/common';
import { TerminalRegistry as Registry } from '@alune/agent/terminals';
export type { TerminalScope } from '@alune/agent/terminals';

@Injectable()
export class TerminalRegistry extends Registry {
  constructor() {
    super(
      (message, sessions) =>
        new ConflictException(
          sessions
            ? { message, code: 'TERMINAL_CONFIRM_REQUIRED', sessions }
            : message,
        ),
    );
  }
}
@Global()
@Module({ providers: [TerminalRegistry], exports: [TerminalRegistry] })
export class TerminalRegistryModule {}
