import { BadRequestException, Body, Controller, Headers, Post, Req } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';
import { PricingApplicationService } from '../application/index.js';
import type { OfferingQuoteSnapshot } from '@satori/application';

class BusinessContextDto {
  @IsString() @MinLength(1) @MaxLength(64) type!: string;
  @IsString() @MinLength(1) @MaxLength(128) id!: string;
}

class CreateCheckoutQuoteDto {
  @IsString() offeringId!: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) offeringVersion?: number;
  @IsOptional() @ValidateNested() @Type(() => BusinessContextDto) businessContext?: BusinessContextDto | null;
}

type CommerceRequest = FastifyRequest & { auth: { userId: string } };

@Controller('checkout-quotes')
export class PricingController {
  constructor(private readonly pricing: PricingApplicationService) {}

  @Post()
  async create(
    @Req() request: CommerceRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Headers('x-request-id') requestId: string | undefined,
    @Body() body: CreateCheckoutQuoteDto,
  ) {
    if (!idempotencyKey || idempotencyKey.length < 16 || idempotencyKey.length > 128) {
      throw new BadRequestException({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    }
    const quote = await this.pricing.createQuote({
      ownerUserId: request.auth.userId,
      offeringId: body.offeringId,
      ...(body.offeringVersion === undefined ? {} : { offeringVersion: body.offeringVersion }),
      ...(body.businessContext === undefined ? {} : { businessContext: body.businessContext }),
      idempotencyKey,
      requestId: validUuid(requestId) ? requestId : randomUUID(),
    });
    return {
      data: {
        ...quote,
        offering: toOfferingResponse(quote.offering),
        price: { amount: quote.price.amountMinor, currency: quote.price.currency },
        issuedAt: quote.issuedAt.toISOString(),
        expiresAt: quote.expiresAt.toISOString(),
      },
    };
  }
}

function toOfferingResponse(offering: OfferingQuoteSnapshot) {
  return {
    offeringId: offering.offeringId,
    offeringVersionId: offering.offeringVersionId,
    offeringVersion: String(offering.offeringVersion),
    businessSpace: 'C_CONSUMER',
    code: offering.offeringCode,
    name: offering.displayName,
    kind:
      offering.offeringKind === 'SINGLE'
        ? 'SINGLE_SERVICE'
        : offering.offeringKind === 'PACKAGE'
          ? 'SERVICE_PACK'
          : 'MEMBERSHIP_PLAN',
    serviceType: toPublicServiceType(offering.serviceType),
    status: 'ACTIVE',
    price: { amount: offering.amountMinor, currency: offering.currency },
    benefits: Array.isArray(offering.entitlementSpec.benefits)
      ? offering.entitlementSpec.benefits.map(toPublicBenefit)
      : [],
    validityDays: offering.validityDays,
    purchaseLimit:
      typeof offering.purchaseLimit.lifetime === 'number' ? offering.purchaseLimit.lifetime : null,
    refundPolicyVersion: offering.refundPolicyVersion,
    agreementVersion: offering.termsVersion,
  };
}

function toPublicBenefit(value: unknown) {
  const benefit = value as Record<string, unknown>;
  return {
    serviceType: toPublicServiceType(String(benefit.serviceType)),
    unit: 'COUNT',
    quantity: Number(benefit.quantity),
  };
}

function toPublicServiceType(value: string) {
  return value === 'DAILY_INSIGHT' ? 'DAILY_ENERGY' : 'CARD_READING';
}

function validUuid(value: string | undefined): value is string {
  return Boolean(
    value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
  );
}
