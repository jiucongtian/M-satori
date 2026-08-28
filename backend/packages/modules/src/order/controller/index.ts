import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { IsString } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { OrderApplicationService, type MoneyOrderView } from '../application/index.js';

class CreateMoneyOrderDto {
  @IsString() quoteId!: string;
}
type AuthRequest = FastifyRequest & { auth: { userId: string } };

@Controller('money-orders')
export class OrderController {
  constructor(private readonly orders: OrderApplicationService) {}

  @Post()
  async create(
    @Req() request: AuthRequest,
    @Headers('idempotency-key') key: string,
    @Body() body: CreateMoneyOrderDto,
  ) {
    return {
      data: serialize(
        await this.orders.create({
          ownerUserId: request.auth.userId,
          quoteId: body.quoteId,
          idempotencyKey: key,
          requestId: request.id,
        }),
      ),
    };
  }

  @Get()
  async list(@Req() request: AuthRequest, @Query('limit') limit?: string) {
    const data = await this.orders.list(request.auth.userId, Number(limit ?? 20));
    return { data: data.map(serialize), meta: { hasMore: false, nextCursor: null } };
  }

  @Get(':orderId')
  async get(@Req() request: AuthRequest, @Param('orderId') orderId: string) {
    return { data: serialize(await this.orders.get(request.auth.userId, orderId)) };
  }

  @Post(':orderId/cancel')
  async cancel(@Req() request: AuthRequest, @Param('orderId') orderId: string) {
    return { data: serialize(await this.orders.cancel(request.auth.userId, orderId, request.id)) };
  }
}

function serialize(order: MoneyOrderView) {
  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    status: order.status,
    offeringSnapshot: order.offeringSnapshot,
    amount: order.amount,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: order.fulfillmentStatus,
    businessContext: order.businessContext,
    createdAt: order.createdAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
  };
}
