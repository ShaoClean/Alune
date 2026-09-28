import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { AccessTokensService } from './access-tokens.service';

@Controller('access-tokens')
export class AccessTokensController {
  constructor(private readonly tokens: AccessTokensService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list() {
    return this.tokens.list();
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(@Body() body: unknown) {
    return this.tokens.save(null, body);
  }

  @Put(':id')
  @Header('Cache-Control', 'no-store')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tokens.save(id, body);
  }

  @Delete(':id')
  @Header('Cache-Control', 'no-store')
  delete(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.tokens.delete(id, body);
  }
}
