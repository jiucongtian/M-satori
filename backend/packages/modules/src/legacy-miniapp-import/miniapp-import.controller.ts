import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
} from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import type { AuthenticatedRequest } from '../identity/auth/authenticated-request.js';
import { requireIdempotencyKey } from '../profile/self-profile.controller.js';
import { MiniappImportService } from './miniapp-import.service.js';

class MiniappImportDecisionDto {
  @IsString() @Length(64, 64) offerId!: string;
  @IsIn(['ACCEPT', 'DECLINE']) decision!: 'ACCEPT' | 'DECLINE';
}

@Controller('me/miniapp-import')
export class MiniappImportController {
  constructor(private readonly imports: MiniappImportService) {}

  @Get()
  @Header('Cache-Control', 'private, no-store')
  status(@Req() request: AuthenticatedRequest) {
    return this.imports.status(request.auth.userId);
  }

  @Post('decision')
  @HttpCode(200)
  @Header('Cache-Control', 'private, no-store')
  decide(
    @Req() request: AuthenticatedRequest,
    @Headers('idempotency-key') key: string | undefined,
    @Body() body: MiniappImportDecisionDto,
  ) {
    return this.imports.decide(request.auth.userId, { ...body, idempotencyKey: requireIdempotencyKey(key) });
  }

  @Get('profiles/:profileId')
  @Header('Cache-Control', 'private, no-store')
  profileSource(@Req() request: AuthenticatedRequest, @Param('profileId', ParseUUIDPipe) profileId: string) {
    return this.imports.profileSource(request.auth.userId, profileId);
  }
}
