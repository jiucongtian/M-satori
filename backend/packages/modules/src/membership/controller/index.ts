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
    return { data: await this.memberships.getCurrent(request.auth.userId) };
  }

  @Get('memberships/periods')
  async periods(@Req() request: AuthRequest) {
    return {
      data: await this.memberships.listPeriods(request.auth.userId),
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
