import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';
import { Public } from '@satori/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  PAYMENT_PAYER_AUTHORIZER,
  PaymentApplicationService,
  type PaymentAttemptView,
  type PaymentPayerAuthorizer,
} from '../application/index.js';
import { WechatWebhookNetworkGuard } from './wechat-webhook-network.guard.js';

class CreatePaymentAttemptDto {
  @IsOptional() @IsString() @Matches(/^[0-9A-Za-z_-]{32,128}$/) payerTicket?: string;
}
class PrepareWechatPayerDto {
  @IsString() returnPath!: string;
}
type AuthRequest = FastifyRequest & { auth: { userId: string } };

@Controller()
export class PaymentController {
  constructor(
    private readonly payments: PaymentApplicationService,
    @Inject(PAYMENT_PAYER_AUTHORIZER) private readonly payerAuthorizer: PaymentPayerAuthorizer,
  ) {}

  @Post('payment-payer/wechat/prepare')
  async prepareWechatPayer(@Req() request: AuthRequest, @Body() body: PrepareWechatPayerDto) {
    return { data: await this.payerAuthorizer.prepare(request.auth.userId, body.returnPath) };
  }

  @Get('payment-payer/wechat/callback')
  @Public()
  async completeWechatPayer(
    @Req() request: FastifyRequest<{ Querystring: { code?: string; state?: string } }>,
    @Res() reply: FastifyReply,
  ) {
    const { code, state } = request.query;
    const target = await this.payerAuthorizer.complete(code ?? '', state ?? '');
    return reply.code(302).redirect(target);
  }

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
          provider: this.payerAuthorizer.provider(),
          idempotencyKey: key,
          requestId: request.id,
          ...(body.payerTicket ? { payerTicket: body.payerTicket } : {}),
        }),
      ),
    };
  }

  @Get('payment-attempts/:attemptId')
  async get(@Req() request: AuthRequest, @Param('attemptId') attemptId: string) {
    return { data: serialize(await this.payments.query(request.auth.userId, attemptId)) };
  }

  @Post('internal/payment-webhooks/wechat')
  @Public()
  @HttpCode(204)
  @UseGuards(WechatWebhookNetworkGuard)
  async webhook(@Req() request: FastifyRequest) {
    const headers = Object.fromEntries(
      Object.entries(request.headers).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    );
    await this.payments.acceptWebhook(headers, request.rawBody ?? JSON.stringify(request.body));
  }
}

function serialize(attempt: PaymentAttemptView) {
  return {
    paymentAttemptId: attempt.paymentAttemptId,
    orderId: attempt.orderId,
    provider: attempt.provider,
    status: attempt.status === 'CANCELLED' ? 'FAILED' : attempt.status,
    amount: { amount: attempt.amountMinor, currency: attempt.currency },
    clientParameters: attempt.clientParameters,
    providerTradeId: attempt.providerAttemptId,
    createdAt: attempt.createdAt.toISOString(),
    succeededAt: attempt.succeededAt?.toISOString() ?? null,
  };
}
