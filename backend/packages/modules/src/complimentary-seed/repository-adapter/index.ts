import type { BusinessSpace } from '@satori/domain';
import type { SeedEligibilityPort } from '@satori/application';
import { Inject, Injectable } from '@nestjs/common';
import { complimentarySeedAccountProjections, RuntimeInfrastructure } from '@satori/infrastructure';
import { and, eq } from 'drizzle-orm';

@Injectable()
export class DrizzleSeedEligibilityAdapter implements SeedEligibilityPort {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  async getAvailableSeedQuantity(ownerUserId: string, businessSpace: BusinessSpace): Promise<number> {
    const [projection] = await this.infrastructure.database
      .select({ available: complimentarySeedAccountProjections.availableQuantity })
      .from(complimentarySeedAccountProjections)
      .where(
        and(
          eq(complimentarySeedAccountProjections.ownerUserId, ownerUserId),
          eq(complimentarySeedAccountProjections.businessSpace, businessSpace),
        ),
      )
      .limit(1);
    return projection?.available ?? 0;
  }
}
