import type { MembershipGrantPort } from '@satori/application';
export class PendingMembershipGrantService implements MembershipGrantPort {
  activate(): never {
    throw Object.assign(new Error('Membership fulfillment is not available yet'), {
      code: 'MEMBERSHIP_FULFILLMENT_PENDING',
      retryable: true,
    });
  }
  queueRenewal(): never {
    throw new Error('Membership renewal is not available yet');
  }
  replaceForUpgrade(): never {
    throw new Error('Membership upgrade is not available yet');
  }
}
