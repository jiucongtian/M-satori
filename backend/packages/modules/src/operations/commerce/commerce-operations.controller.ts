import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Min, MinLength } from 'class-validator';
import type { AuthenticatedRequest } from '../../identity/auth/authenticated-request.js';
import { CommerceOperationsService } from './commerce-operations.service.js';
import { OperatorRoleGuard } from './operator-role.guard.js';

class AdjustmentDto {
  @IsUUID() ownerUserId!: string;
  @IsInt() @Min(1) quantity!: number;
  @IsIn(['INCREASE', 'DECREASE']) direction!: 'INCREASE' | 'DECREASE';
  @IsString() @MinLength(3) reasonCode!: string;
  @IsString() @MinLength(3) note!: string;
  @IsOptional() @IsUUID() relatedOrderId?: string;
}
class ReasonDto {
  @IsString() @MinLength(3) reasonCode!: string;
  @IsString() @MinLength(3) note!: string;
}
class ResolveDto {
  @IsString() @MinLength(3) note!: string;
}

@UseGuards(OperatorRoleGuard)
@Controller('operations/commerce')
export class CommerceOperationsController {
  constructor(private readonly operations: CommerceOperationsService) {}

  @Get('orders/:orderId')
  async order(@Param('orderId') orderId: string) {
    return { data: await this.operations.orderView(orderId) };
  }

  @Get('owners/:ownerUserId')
  async owner(@Param('ownerUserId') ownerUserId: string) {
    return { data: await this.operations.ownerView(ownerUserId) };
  }

  @Post('entitlements/:grantId/adjustments')
  async adjustEntitlement(
    @Req() request: AuthenticatedRequest,
    @Param('grantId') grantId: string,
    @Body() body: AdjustmentDto,
  ) {
    return {
      data: await this.operations.adjustEntitlement({
        ...body,
        grantId,
        operatorUserId: request.auth.userId,
        requestId: request.id,
      }),
    };
  }

  @Post('seeds/:grantId/adjustments')
  async adjustSeeds(
    @Req() request: AuthenticatedRequest,
    @Param('grantId') grantId: string,
    @Body() body: AdjustmentDto,
  ) {
    await this.operations.adjustSeeds({
      ...body,
      grantId,
      operatorUserId: request.auth.userId,
      requestId: request.id,
    });
    return { data: { adjusted: true } };
  }

  @Post('entitlement-sources/:sourceId/forfeit')
  async forfeit(
    @Req() request: AuthenticatedRequest,
    @Param('sourceId') sourceId: string,
    @Body() body: ReasonDto,
  ) {
    await this.operations.forfeitEntitlements(
      sourceId,
      body.reasonCode,
      body.note,
      request.auth.userId,
      request.id,
    );
    return { data: { forfeited: true } };
  }

  @Post('entitlement-sources/:sourceId/restore')
  async restore(
    @Req() request: AuthenticatedRequest,
    @Param('sourceId') sourceId: string,
    @Body() body: ReasonDto,
  ) {
    await this.operations.restoreEntitlements(
      sourceId,
      body.reasonCode,
      body.note,
      request.auth.userId,
      request.id,
    );
    return { data: { restored: true } };
  }

  @Post('consumption-intents/:intentId/release')
  async release(
    @Req() request: AuthenticatedRequest,
    @Param('intentId') intentId: string,
    @Body() body: ReasonDto,
  ) {
    return {
      data: await this.operations.releaseConsumption(
        intentId,
        body.reasonCode,
        body.note,
        request.auth.userId,
        request.id,
      ),
    };
  }

  @Get('reconciliation-cases')
  async cases() {
    return { data: await this.operations.listCases(), meta: { hasMore: false, nextCursor: null } };
  }

  @Post('reconciliation-cases/:caseId/resolve')
  async resolve(
    @Req() request: AuthenticatedRequest,
    @Param('caseId') caseId: string,
    @Body() body: ResolveDto,
  ) {
    return { data: await this.operations.resolveCase(caseId, request.auth.userId, body.note) };
  }

  @Get('metrics')
  async metrics() {
    return { data: await this.operations.metrics() };
  }
}
