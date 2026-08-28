import { Controller, Get, Param, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { CatalogApplicationService } from '../application/index.js';
import type { CatalogOffering } from '../domain/index.js';

class CatalogQuery {
  @IsOptional() @IsIn(['STORE', 'SHORTAGE']) context?: 'STORE' | 'SHORTAGE';
}

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogApplicationService) {}

  @Get('service-offerings')
  async list(@Query() query: CatalogQuery) {
    return {
      data: (await this.catalog.list(query.context)).map(toOfferingResponse),
      meta: { hasMore: false, nextCursor: null },
    };
  }

  @Get('service-offerings/:offeringId')
  async get(@Param('offeringId') offeringId: string) {
    return { data: toOfferingResponse(await this.catalog.get(offeringId)) };
  }

  @Get('membership-plans')
  async listMembershipPlans() {
    return {
      data: (await this.catalog.listMembershipPlans()).map((offering) => ({
        ...toOfferingResponse(offering),
        planCode: membershipPlanCode(offering.offeringCode),
        periodDays: 30,
        seedActivityPrice: null,
        seedThreshold: null,
      })),
    };
  }
}

function toOfferingResponse(offering: CatalogOffering) {
  const benefits = Array.isArray(offering.entitlementSpec.benefits) ? offering.entitlementSpec.benefits : [];
  return {
    offeringId: offering.offeringId,
    offeringVersion: String(offering.offeringVersion),
    businessSpace: offering.businessSpace,
    code: offering.offeringCode,
    name: offering.displayName,
    kind:
      offering.offeringKind === 'SINGLE'
        ? 'SINGLE_SERVICE'
        : offering.offeringKind === 'PACKAGE'
          ? 'SERVICE_PACK'
          : 'MEMBERSHIP_PLAN',
    serviceType: offering.serviceType,
    status: 'ACTIVE',
    price: { amount: offering.amountMinor, currency: offering.currency },
    benefits,
    validityDays: offering.validityDays,
    purchaseLimit:
      typeof offering.purchaseLimit.lifetime === 'number' ? offering.purchaseLimit.lifetime : null,
    refundPolicyVersion: offering.refundPolicyVersion,
    agreementVersion: offering.termsVersion,
  };
}

function membershipPlanCode(code: string) {
  if (code.includes('glow')) return 'GLOW';
  if (code.includes('serenity')) return 'SERENITY';
  return 'FREEDOM';
}
