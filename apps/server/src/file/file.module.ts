import { Module } from '@nestjs/common';
import { FileService } from './file.service';
import { FileController } from './file.controller';
import { ConnectionModule } from '../connection/connection.module';
import { RepositoryModule } from '../repository/repository.module';

@Module({
  imports: [ConnectionModule, RepositoryModule],
  controllers: [FileController],
  providers: [FileService],
})
export class FileModule {}