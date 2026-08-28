import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { RefundApplicationService } from '../application/index.js';

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
    return { data: await this.refunds.request(request.auth.userId, body.orderId, request.id) };
  }

  @Get('refunds')
  async list(@Req() request: AuthRequest) {
    return { data: await this.refunds.list(request.auth.userId), meta: { hasMore: false, nextCursor: null } };
  }
}
