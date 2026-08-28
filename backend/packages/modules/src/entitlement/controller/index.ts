import { Controller, Get, NotFoundException, Param, Query, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import type { AuthenticatedRequest } from '../../identity/auth/authenticated-request.js';
import { EntitlementApplicationService } from '../application/index.js';

class EntitlementListQuery {
  @IsOptional() @IsString() cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number;
}

@Controller('me')
export class EntitlementController {
  constructor(private readonly entitlements: EntitlementApplicationService) {}

  @Get('entitlements')
  list(@Req() request: AuthenticatedRequest, @Query() query: EntitlementListQuery) {
    return this.entitlements.list(request.auth.userId, query);
  }

  @Get('entitlements/:entitlementId')
  async get(@Req() request: AuthenticatedRequest, @Param('entitlementId') entitlementId: string) {
    const entitlement = await this.entitlements.get(request.auth.userId, entitlementId);
    if (!entitlement) {
      throw new NotFoundException({ code: 'ENTITLEMENT_NOT_FOUND', message: 'Entitlement was not found' });
    }
    return { data: entitlement };
  }

  @Get('usage-records')
  listUsage(@Req() request: AuthenticatedRequest, @Query() query: EntitlementListQuery) {
    return this.entitlements.listUsage(request.auth.userId, query);
  }
}
