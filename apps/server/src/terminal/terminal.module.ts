import { Controller, Get, Module, Query } from '@nestjs/common';
import { ConnectionModule } from '../connection/connection.module';
import { RepositoryModule } from '../repository/repository.module';
import { TerminalRegistry, TerminalRegistryModule } from './terminal-registry';
import { TerminalService } from './terminal.service';
import { TerminalGateway } from './terminal.gateway';

@Controller('terminals')
class TerminalController {
  constructor(private registry: TerminalRegistry) {}
  @Get('impact')
  impact(
    @Query('repositoryId') repositoryId?: string,
    @Query('connectionId') connectionId?: string,
  ) {
    return this.registry.impact({ repositoryId, connectionId });
  }
}

@Module({
  imports: [TerminalRegistryModule, RepositoryModule, ConnectionModule],
  controllers: [TerminalController],
  providers: [TerminalService, TerminalGateway],
})
export class TerminalModule {}
