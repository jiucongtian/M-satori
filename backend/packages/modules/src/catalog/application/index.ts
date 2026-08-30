import type { OfferingQuoteSnapshot } from '@satori/application';
import { assertR11Sellable, type CatalogOffering, OfferingNotFoundError } from '../domain/index.js';

export const CATALOG_REPOSITORY = Symbol('CATALOG_REPOSITORY');

export interface PublishOfferingVersionCommand {
  readonly offeringId: string;
  readonly version: number;
  readonly displayName: string;
  readonly description: string;
  readonly amountMinor: number;
  readonly entitlementSpec: Readonly<Record<string, unknown>>;
  readonly validityDays: number | null;
  readonly purchaseLimit: Readonly<Record<string, unknown>>;
  readonly refundPolicyVersion: string;
  readonly refundPolicy: Readonly<Record<string, unknown>>;
  readonly termsVersion: string;
  readonly effectiveFrom: Date;
}

export interface CatalogRepository {
  listPublished(): Promise<readonly CatalogOffering[]>;
  findPublished(offeringId: string, version?: number): Promise<CatalogOffering | null>;
  publishVersion(command: PublishOfferingVersionCommand): Promise<OfferingQuoteSnapshot>;
  listVersionHistory(offeringId: string): Promise<readonly OfferingQuoteSnapshot[]>;
}

export class CatalogApplicationService {
  constructor(private readonly repository: CatalogRepository) {}

  async list(channel: 'STORE' | 'SHORTAGE' = 'STORE') {
    return (await this.repository.listPublished()).filter(
      (offering) =>
        offering.offeringKind !== 'MEMBERSHIP' && offering.displayChannels.includes(channel),
    );
  }

  async get(offeringId: string) {
    const offering = await this.repository.findPublished(offeringId);
    if (!offering) throw new OfferingNotFoundError(offeringId);
    return offering;
  }

  async listMembershipPlans() {
    return (await this.repository.listPublished()).filter(
      (offering) => offering.offeringKind === 'MEMBERSHIP',
    );
  }

  async publish(command: PublishOfferingVersionCommand) {
    const current = await this.repository.findPublished(command.offeringId);
    if (!current) throw new OfferingNotFoundError(command.offeringId);
    assertR11Sellable(current.offeringCode);
    return this.repository.publishVersion(command);
  }

  listVersionHistory(offeringId: string) {
    return this.repository.listVersionHistory(offeringId);
  }
}
