import { IdempotencyKeyReusedError, type PurchaseHistoryPort } from '@satori/application';
import { Inject, Injectable } from '@nestjs/common';
import {
  checkoutQuotes,
  fulfillmentJobs,
  moneyOrders,
  offeringVersions,
  orderSnapshots,
  paymentAttempts,
  RuntimeInfrastructure,
} from '@satori/infrastructure';
import { and, count, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { CreateMoneyOrderCommand, MoneyOrderView, OrderRepository } from '../application/index.js';
import { MoneyOrderError } from '../domain/index.js';

@Injectable()
export class DrizzleOrderRepository implements OrderRepository, PurchaseHistoryPort {
  constructor(@Inject(RuntimeInfrastructure) private readonly infrastructure: RuntimeInfrastructure) {}

  async create(
    command: CreateMoneyOrderCommand & { orderId: string; requestHash: string; expiresAt: Date },
    reservePromotion: Parameters<OrderRepository['create']>[1],
    releasePromotion: Parameters<OrderRepository['create']>[2],
  ) {
    let reservedId: string | null = null;
    try {
      return await this.infrastructure.database.transaction(async (tx) => {
        const [replay] = await tx
          .select()
          .from(moneyOrders)
          .where(
            and(
              eq(moneyOrders.ownerUserId, command.ownerUserId),
              eq(moneyOrders.idempotencyKey, command.idempotencyKey),
            ),
          )
          .limit(1);
        if (replay) {
          if (replay.requestHash !== command.requestHash) throw new IdempotencyKeyReusedError();
          return this.toView(replay);
        }
        const [quote] = await tx
          .select()
          .from(checkoutQuotes)
          .where(eq(checkoutQuotes.id, command.quoteId))
          .for('update')
          .limit(1);
        if (!quote || quote.ownerUserId !== command.ownerUserId)
          throw new MoneyOrderError('CHECKOUT_QUOTE_NOT_FOUND', 'Checkout quote was not found');
        const [existing] = await tx
          .select()
          .from(moneyOrders)
          .where(eq(moneyOrders.checkoutQuoteId, quote.id))
          .limit(1);
        if (existing) return this.toView(existing);
        if (quote.status !== 'ACTIVE' || quote.expiresAt <= new Date())
          throw new MoneyOrderError('CHECKOUT_QUOTE_EXPIRED', 'Checkout quote has expired');

        const quoteView = asRecord(asRecord(quote.pricingSnapshot).quoteView);
        const offering = asRecord(quoteView.offering);
        const offeringId = stringValue(offering.offeringId);
        const lifetime = numberValue(asRecord(offering.purchaseLimit).lifetime);
        if (offeringId && lifetime !== null) {
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`${command.ownerUserId}:${offeringId}`}, 0))`,
          );
          const [purchases] = await tx
            .select({ value: count() })
            .from(moneyOrders)
            .innerJoin(offeringVersions, eq(moneyOrders.offeringVersionId, offeringVersions.id))
            .where(
              and(
                eq(moneyOrders.ownerUserId, command.ownerUserId),
                eq(offeringVersions.offeringId, offeringId),
                eq(moneyOrders.status, 'FULFILLED'),
              ),
            );
          if ((purchases?.value ?? 0) >= lifetime)
            throw new MoneyOrderError('PURCHASE_LIMIT_REACHED', 'Offering purchase limit reached');
        }
        const serviceType = offering.serviceType;
        if (quote.reservedSeedQuantity > 0) {
          if (serviceType !== 'DAILY_INSIGHT' && serviceType !== 'CARD_READING')
            throw new MoneyOrderError('INVALID_OFFERING_SNAPSHOT', 'Offering service type is invalid');
          reservedId = (
            await reservePromotion({
              ownerUserId: command.ownerUserId,
              serviceType,
              orderId: command.orderId,
              quantity: quote.reservedSeedQuantity,
              expiresAt: command.expiresAt,
              requestId: command.requestId,
            })
          ).reservationId;
        }
        const now = new Date();
        const [created] = await tx
          .insert(moneyOrders)
          .values({
            id: command.orderId,
            orderNumber: orderNumber(command.orderId, now),
            ownerUserId: command.ownerUserId,
            businessSpace: quote.businessSpace,
            checkoutQuoteId: quote.id,
            offeringVersionId: quote.offeringVersionId,
            amountMinor: quote.amountMinor,
            businessContextType: quote.businessContextType,
            businessContextId: quote.businessContextId,
            promotionSeedReservationId: reservedId,
            idempotencyKey: command.idempotencyKey,
            requestHash: command.requestHash,
            requestId: command.requestId,
            expiresAt: command.expiresAt,
            createdAt: now,
          })
          .returning();
        await tx.insert(orderSnapshots).values({
          id: randomUUID(),
          orderId: created!.id,
          offeringSnapshot: offering,
          quoteSnapshot: quoteView,
          refundPolicySnapshot: asRecord(offering.refundPolicy),
          termsSnapshot: { version: offering.termsVersion ?? null },
        });
        await tx
          .update(checkoutQuotes)
          .set({ status: 'CONSUMED', consumedAt: now })
          .where(eq(checkoutQuotes.id, quote.id));
        return this.toView(created!, offering);
      });
    } catch (error) {
      if (reservedId)
        await releasePromotion(reservedId, command.orderId, command.requestId).catch(() => undefined);
      throw error;
    }
  }

  async getOwned(ownerUserId: string, orderId: string) {
    const [row] = await this.infrastructure.database
      .select()
      .from(moneyOrders)
      .where(and(eq(moneyOrders.id, orderId), eq(moneyOrders.ownerUserId, ownerUserId)))
      .limit(1);
    return row ? this.toView(row) : null;
  }

  async listOwned(ownerUserId: string, limit: number) {
    const rows = await this.infrastructure.database
      .select()
      .from(moneyOrders)
      .where(eq(moneyOrders.ownerUserId, ownerUserId))
      .orderBy(desc(moneyOrders.createdAt), desc(moneyOrders.id))
      .limit(limit);
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  async closeOwned(ownerUserId: string, orderId: string) {
    return this.infrastructure.database.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(moneyOrders)
        .where(and(eq(moneyOrders.id, orderId), eq(moneyOrders.ownerUserId, ownerUserId)))
        .for('update')
        .limit(1);
      if (!row) throw new MoneyOrderError('MONEY_ORDER_NOT_FOUND', 'Money order was not found');
      if (row.status === 'CLOSED') return this.toView(row);
      if (row.status !== 'PENDING_PAYMENT')
        throw new MoneyOrderError('MONEY_ORDER_NOT_CANCELLABLE', 'Money order cannot be cancelled');
      const [closed] = await tx
        .update(moneyOrders)
        .set({
          status: 'CLOSED',
          closedAt: new Date(),
          version: row.version + 1,
          updatedAt: new Date(),
        })
        .where(eq(moneyOrders.id, row.id))
        .returning();
      return this.toView(closed!);
    });
  }

  async closeExpired(now: Date, limit: number) {
    const due = await this.infrastructure.database
      .select({ id: moneyOrders.id, ownerUserId: moneyOrders.ownerUserId })
      .from(moneyOrders)
      .where(and(eq(moneyOrders.status, 'PENDING_PAYMENT'), lt(moneyOrders.expiresAt, now)))
      .limit(limit);
    const closed: MoneyOrderView[] = [];
    for (const order of due) {
      try {
        closed.push(await this.closeOwned(order.ownerUserId, order.id));
      } catch {
        /* payment won */
      }
    }
    return closed;
  }

  async countFulfilledPurchases(ownerUserId: string, offeringId: string): Promise<number> {
    const [result] = await this.infrastructure.database
      .select({ value: count() })
      .from(moneyOrders)
      .innerJoin(offeringVersions, eq(moneyOrders.offeringVersionId, offeringVersions.id))
      .where(
        and(
          eq(moneyOrders.ownerUserId, ownerUserId),
          eq(offeringVersions.offeringId, offeringId),
          inArray(moneyOrders.status, ['PAID', 'FULFILLING', 'FULFILLED', 'EXCEPTION', 'REFUNDING']),
        ),
      );
    return result?.value ?? 0;
  }

  private async toView(row: typeof moneyOrders.$inferSelect, suppliedOffering?: Record<string, unknown>) {
    const [snapshot] = suppliedOffering
      ? [{ offeringSnapshot: suppliedOffering }]
      : await this.infrastructure.database
          .select({ offeringSnapshot: orderSnapshots.offeringSnapshot })
          .from(orderSnapshots)
          .where(eq(orderSnapshots.orderId, row.id))
          .limit(1);
    const [payment] = await this.infrastructure.database
      .select({ status: paymentAttempts.status })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, row.id))
      .orderBy(desc(paymentAttempts.createdAt))
      .limit(1);
    const [fulfillment] = await this.infrastructure.database
      .select({ status: fulfillmentJobs.status })
      .from(fulfillmentJobs)
      .where(eq(fulfillmentJobs.orderId, row.id))
      .orderBy(desc(fulfillmentJobs.createdAt))
      .limit(1);
    return {
      orderId: row.id,
      orderNumber: row.orderNumber,
      ownerUserId: row.ownerUserId,
      status: row.status === 'PENDING_PAYMENT' ? 'AWAITING_PAYMENT' : row.status,
      offeringSnapshot: asRecord(snapshot?.offeringSnapshot),
      amount: { amount: row.amountMinor, currency: 'CNY' as const },
      paymentStatus: payment?.status ?? 'NOT_STARTED',
      fulfillmentStatus: fulfillment?.status ?? 'NOT_STARTED',
      businessContext:
        row.businessContextType && row.businessContextId
          ? { type: row.businessContextType, id: row.businessContextId }
          : null,
      promotionSeedReservationId: row.promotionSeedReservationId,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      paidAt: row.paidAt,
    };
  }
}

function orderNumber(id: string, now: Date) {
  return `S${now.toISOString().slice(0, 10).replaceAll('-', '')}${id.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
}
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function stringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}
function numberValue(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
