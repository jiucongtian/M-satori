import type { PurchaseHistoryPort } from '@satori/application';
import { Inject, Injectable } from '@nestjs/common';
import { moneyOrders, offeringVersions, RuntimeInfrastructure } from '@satori/infrastructure';
import { and, count, eq } from 'drizzle-orm';

@Injectable()
export class DrizzlePurchaseHistoryAdapter implements PurchaseHistoryPort {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  async countFulfilledPurchases(ownerUserId: string, offeringId: string): Promise<number> {
    const [result] = await this.infrastructure.database
      .select({ value: count() })
      .from(moneyOrders)
      .innerJoin(offeringVersions, eq(moneyOrders.offeringVersionId, offeringVersions.id))
      .where(
        and(
          eq(moneyOrders.ownerUserId, ownerUserId),
          eq(offeringVersions.offeringId, offeringId),
          eq(moneyOrders.status, 'FULFILLED'),
        ),
      );
    return result?.value ?? 0;
  }
}
