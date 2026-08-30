import { BadRequestException, Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { AuthenticatedRequest } from '../identity/auth/authenticated-request.js';
import { SeedLedgerService } from './seed-ledger.service.js';

class LedgerQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@Controller('me')
export class SeedLedgerController {
  constructor(private readonly ledger: SeedLedgerService) {}

  @Get('wisdom-seed-account')
  getAccount(@Req() request: AuthenticatedRequest) {
    return this.ledger.getAccount(request.auth.userId);
  }

  @Get('wisdom-seed-transactions')
  list(@Req() request: AuthenticatedRequest, @Query() query: LedgerQuery) {
    return this.ledger.listTransactions(request.auth.userId, query);
  }

  @Get('registration-reward')
  getReward(@Req() request: AuthenticatedRequest) {
    return this.ledger.getRegistrationReward(request.auth.userId);
  }

  @Post('registration-reward/claim')
  @HttpCode(200)
  claim(@Req() request: AuthenticatedRequest, @Headers('idempotency-key') key: string | undefined) {
    if (!key || key.length < 16 || key.length > 128)
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: 'A 16-128 character Idempotency-Key is required',
      });
    return this.ledger.claimRegistrationReward(request.auth.userId);
  }
}
