import { hashPayload, type BusinessClock, type SeedPromotionLifecyclePort } from '@satori/application';
import type { BusinessContext } from '@satori/domain';
import { randomUUID } from 'node:crypto';
import { MONEY_ORDER_TTL_MS } from '../domain/index.js';

export const ORDER_REPOSITORY = Symbol('ORDER_REPOSITORY');

export interface MoneyOrderView {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly ownerUserId: string;
  readonly status: string;
  readonly offeringSnapshot: Readonly<Record<string, unknown>>;
  readonly amount: { readonly amount: number; readonly currency: 'CNY' };
  readonly paymentStatus: string;
  readonly fulfillmentStatus: string;
  readonly businessContext: BusinessContext | null;
  readonly promotionSeedReservationId: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly paidAt: Date | null;
}

export interface CreateMoneyOrderCommand {
  readonly ownerUserId: string;
  readonly quoteId: string;
  readonly idempotencyKey: string;
  readonly requestId: string;
}

export interface OrderRepository {
  create(
    command: CreateMoneyOrderCommand & { orderId: string; requestHash: string; expiresAt: Date },
    reservePromotion: (input: {
      ownerUserId: string;
      serviceType: 'DAILY_INSIGHT' | 'CARD_READING';
      orderId: string;
      quantity: number;
      expiresAt: Date;
      requestId: string;
    }) => Promise<{ reservationId: string }>,
    releasePromotion: (reservationId: string, orderId: string, requestId: string) => Promise<void>,
  ): Promise<MoneyOrderView>;
  getOwned(ownerUserId: string, orderId: string): Promise<MoneyOrderView | null>;
  listOwned(ownerUserId: string, limit: number): Promise<readonly MoneyOrderView[]>;
  closeOwned(ownerUserId: string, orderId: string): Promise<MoneyOrderView>;
  closeExpired(now: Date, limit: number): Promise<readonly MoneyOrderView[]>;
}

export class OrderApplicationService {
  constructor(
    private readonly repository: OrderRepository,
    private readonly seeds: SeedPromotionLifecyclePort,
    private readonly clock: BusinessClock,
  ) {}

  create(command: CreateMoneyOrderCommand) {
    const orderId = randomUUID();
    return this.repository.create(
      {
        ...command,
        orderId,
        requestHash: hashPayload({ quoteId: command.quoteId }),
        expiresAt: new Date(this.clock.now().getTime() + MONEY_ORDER_TTL_MS),
      },
      (input) =>
        this.seeds.reserveForOrderCreation({
          ownerUserId: input.ownerUserId,
          businessSpace: 'SATORI',
          serviceType: input.serviceType,
          orderId: input.orderId,
          quantity: input.quantity,
          reservationExpiresAt: input.expiresAt,
          requestId: input.requestId,
        }),
      (reservationId, currentOrderId, requestId) =>
        this.seeds.releaseAfterOrderClosure(reservationId, currentOrderId, 'ORDER_CANCELLED', requestId),
    );
  }

  async get(ownerUserId: string, orderId: string) {
    const order = await this.repository.getOwned(ownerUserId, orderId);
    if (!order) throw new Error('MONEY_ORDER_NOT_FOUND');
    return order;
  }

  list(ownerUserId: string, limit = 20) {
    return this.repository.listOwned(ownerUserId, Math.min(Math.max(limit, 1), 100));
  }

  async cancel(ownerUserId: string, orderId: string, requestId: string) {
    const order = await this.repository.closeOwned(ownerUserId, orderId);
    if (order.promotionSeedReservationId) {
      await this.seeds.releaseAfterOrderClosure(
        order.promotionSeedReservationId,
        order.orderId,
        'ORDER_CANCELLED',
        requestId,
      );
    }
    return order;
  }

  async closeExpired(limit = 200) {
    const orders = await this.repository.closeExpired(this.clock.now(), limit);
    for (const order of orders) {
      if (order.promotionSeedReservationId) {
        await this.seeds.releaseAfterOrderClosure(
          order.promotionSeedReservationId,
          order.orderId,
          'ORDER_EXPIRED',
          randomUUID(),
        );
      }
    }
    return orders.length;
  }
}
