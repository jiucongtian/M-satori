import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { RefundApplicationService, type RefundRecord } from '../application/index.js';

type AuthRequest = FastifyRequest & { auth: { userId: string } };
class OrderRefundDto {
  @IsUUID() orderId!: string;
}

@Controller()
export class RefundController {
  constructor(private readonly refunds: RefundApplicationService) {}

  @Post('refund-quotes')
  async quote(@Req() request: AuthRequest, @Body() body: OrderRefundDto) {
    return { data: await this.refunds.quote(request.auth.userId, body.orderId) };
  }

  @Post('refunds')
  async request(@Req() request: AuthRequest, @Body() body: OrderRefundDto) {
    const refund = await this.refunds.request(request.auth.userId, body.orderId, request.id);
    return { data: refund ? serialize(refund) : null };
  }

  @Get('refunds')
  async list(@Req() request: AuthRequest) {
    return {
      data: (await this.refunds.list(request.auth.userId)).map(serialize),
      meta: { hasMore: false, nextCursor: null },
    };
  }
}

function serialize(refund: RefundRecord) {
  return {
    refundId: refund.refundId,
    orderId: refund.orderId,
    amount: { amount: refund.amountMinor, currency: 'CNY' as const },
    status: refund.status === 'REJECTED' ? 'FAILED' : refund.status,
    createdAt: refund.createdAt.toISOString(),
    completedAt: refund.completedAt?.toISOString() ?? null,
  };
}
