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
    status: orderStatus(order.status),
    offeringSnapshot: toPublicOfferingSnapshot(order.offeringSnapshot),
    amount: order.amount,
    paymentStatus: order.paymentStatus,
    fulfillmentStatus: fulfillmentStatus(order.fulfillmentStatus),
    businessContext: order.businessContext,
    createdAt: order.createdAt.toISOString(),
    expiresAt: order.expiresAt.toISOString(),
    paidAt: order.paidAt?.toISOString() ?? null,
  };
}

export function toPublicOfferingSnapshot(snapshot: Readonly<Record<string, unknown>>) {
  const benefits = asRecord(snapshot.entitlementSpec).benefits;
  return {
    offeringId: asString(snapshot.offeringId),
    offeringVersionId: asString(snapshot.offeringVersionId),
    offeringVersion: asString(snapshot.offeringVersion),
    businessSpace: 'C_CONSUMER',
    code: asString(snapshot.offeringCode),
    name: asString(snapshot.displayName, '服务订单'),
    kind:
      snapshot.offeringKind === 'SINGLE'
        ? 'SINGLE_SERVICE'
        : snapshot.offeringKind === 'PACKAGE'
          ? 'SERVICE_PACK'
          : snapshot.offeringKind === 'MEMBERSHIP'
            ? 'MEMBERSHIP_PLAN'
            : 'SINGLE_SERVICE',
    serviceType: toPublicServiceType(asString(snapshot.serviceType)),
    status: 'ACTIVE',
    price: {
      amount: Number(snapshot.amountMinor ?? 0),
      currency: asString(snapshot.currency, 'CNY'),
    },
    benefits: Array.isArray(benefits) ? benefits.map(toPublicBenefit) : [],
    validityDays: Number(snapshot.validityDays ?? 0),
    purchaseLimit:
      typeof asRecord(snapshot.purchaseLimit).lifetime === 'number'
        ? asRecord(snapshot.purchaseLimit).lifetime
        : null,
    refundPolicyVersion: asString(snapshot.refundPolicyVersion),
    agreementVersion: asString(snapshot.termsVersion),
  };
}

function toPublicBenefit(value: unknown) {
  const benefit = asRecord(value);
  return {
    serviceType: toPublicServiceType(asString(benefit.serviceType)),
    unit: 'COUNT',
    quantity: Number(benefit.quantity ?? 0),
  };
}

function toPublicServiceType(value: string) {
  return value === 'DAILY_INSIGHT' ? 'DAILY_ENERGY' : 'CARD_READING';
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function orderStatus(status: string) {
  if (status === 'PENDING_PAYMENT' || status === 'PAYMENT_PROCESSING') return 'AWAITING_PAYMENT';
  if (status === 'EXCEPTION') return 'FULFILLMENT_FAILED';
  return status;
}

function fulfillmentStatus(status: string) {
  const statuses: Record<string, string> = {
    RETRY_WAIT: 'RETRY_WAITING',
    FAILED: 'FAILED_FINAL',
    COMPENSATING: 'REVERSING',
    COMPENSATED: 'REVERSED',
  };
  return statuses[status] ?? status;
}
