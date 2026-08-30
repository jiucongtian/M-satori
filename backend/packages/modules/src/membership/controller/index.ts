import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { Equals, IsUUID } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { MembershipApplicationService } from '../application/index.js';

type AuthRequest = FastifyRequest & { auth: { userId: string } };

class UpgradePreviewDto {
  @IsUUID() previousSubscriptionId!: string;
  @IsUUID() targetPlanVersionId!: string;
}

class RegisterUpgradeDto extends UpgradePreviewDto {
  @IsUUID() newOrderId!: string;
  @Equals(true) confirmationAccepted!: boolean;
}

@Controller()
export class MembershipController {
  constructor(private readonly memberships: MembershipApplicationService) {}

  @Get('memberships/current')
  async current(@Req() request: AuthRequest) {
    return { data: serializeSubscription(await this.memberships.getCurrent(request.auth.userId)) };
  }

  @Get('memberships/periods')
  async periods(@Req() request: AuthRequest) {
    return {
      data: (await this.memberships.listPeriods(request.auth.userId)).map(serializePeriod),
      meta: { hasMore: false, nextCursor: null },
    };
  }

  @Post('membership-upgrades/preview')
  async preview(@Req() request: AuthRequest, @Body() body: UpgradePreviewDto) {
    return {
      data: await this.memberships.previewUpgrade(
        request.auth.userId,
        body.previousSubscriptionId,
        body.targetPlanVersionId,
      ),
    };
  }

  @Post('membership-upgrades')
  async register(@Req() request: AuthRequest, @Body() body: RegisterUpgradeDto) {
    return {
      data: await this.memberships.registerUpgrade({
        ownerUserId: request.auth.userId,
        previousSubscriptionId: body.previousSubscriptionId,
        targetPlanVersionId: body.targetPlanVersionId,
        newOrderId: body.newOrderId,
        requestId: request.id,
      }),
    };
  }

  @Get('membership-upgrades')
  async upgrades(@Req() request: AuthRequest) {
    return {
      data: await this.memberships.listUpgrades(request.auth.userId),
      meta: { hasMore: false, nextCursor: null },
    };
  }
}

function serializeSubscription(value: Record<string, unknown> | null) {
  if (!value) return null;
  const periods = Array.isArray(value.periods) ? value.periods.map(serializePeriod) : [];
  return {
    subscriptionId: String(value.subscriptionId),
    activePeriod: periods.find((period) => period.status === 'ACTIVE') ?? null,
    periods,
  };
}

function serializePeriod(value: unknown) {
  const row = value as Record<string, unknown>;
  const rawStatus = String(row.status);
  return {
    periodId: String(row.periodId),
    planCode: String(row.planCode),
    status:
      rawStatus === 'QUEUED'
        ? 'SCHEDULED'
        : rawStatus === 'TERMINATED'
          ? 'TERMINATED_BY_UPGRADE'
          : rawStatus,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    entitlementIds: Array.isArray(row.entitlementIds) ? row.entitlementIds : [],
  };
}
