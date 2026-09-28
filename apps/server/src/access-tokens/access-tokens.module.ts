import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { AccessTokensService } from './access-tokens.service';
import { AccessTokensController } from './access-tokens.controller';

@Module({
  imports: [EventsModule],
  controllers: [AccessTokensController],
  providers: [AccessTokensService],
  exports: [AccessTokensService],
})
export class AccessTokensModule {}
