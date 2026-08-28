import { Body, Controller, Get, Headers, HttpCode, Param, Post, Req } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { PaymentApplicationService, type PaymentAttemptView } from '../application/index.js';

class CreatePaymentAttemptDto {
  @IsOptional() @IsIn(['WECHAT_PAY', 'FAKE']) provider?: 'WECHAT_PAY' | 'FAKE';
}
type AuthRequest = FastifyRequest & { auth: { userId: string } };

@Controller()
export class PaymentController {
  constructor(private readonly payments: PaymentApplicationService) {}

  @Post('money-orders/:orderId/payment-attempts')
  async create(
    @Req() request: AuthRequest,
    @Param('orderId') orderId: string,
    @Headers('idempotency-key') key: string,
    @Body() body: CreatePaymentAttemptDto,
  ) {
    return {
      data: serialize(
        await this.payments.create({
          ownerUserId: request.auth.userId,
          orderId,
          provider: body.provider ?? 'FAKE',
          idempotencyKey: key,
          requestId: request.id,
        }),
      ),
    };
  }

  @Get('payment-attempts/:attemptId')
  async get(@Req() request: AuthRequest, @Param('attemptId') attemptId: string) {
    return { data: serialize(await this.payments.query(request.auth.userId, attemptId)) };
  }

  @Post('internal/payment-webhooks/wechat')
  @HttpCode(204)
  async webhook(@Req() request: FastifyRequest) {
    const headers = Object.fromEntries(
      Object.entries(request.headers).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    await this.payments.acceptWebhook(headers, JSON.stringify(request.body));
  }
}

function serialize(attempt: PaymentAttemptView) {
  return {
    paymentAttemptId: attempt.paymentAttemptId,
    orderId: attempt.orderId,
    provider: attempt.provider,
    status: attempt.status,
    amount: { amount: attempt.amountMinor, currency: attempt.currency },
    clientParameters: attempt.clientParameters,
    providerTradeId: attempt.providerAttemptId,
    createdAt: attempt.createdAt.toISOString(),
    succeededAt: attempt.succeededAt?.toISOString() ?? null,
  };
}
