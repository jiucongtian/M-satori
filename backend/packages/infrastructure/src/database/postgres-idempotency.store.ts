import type { IdempotencyScope, IdempotencyStore, StoredIdempotencyRecord } from '@satori/application';
import { and, eq, isNull, lt } from 'drizzle-orm';
import type { Database } from './client.js';
import { newId } from './ids.js';
import { idempotencyRecords } from './schema.js';
import type { FieldCipher } from '../security/field-cipher.js';

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(
    private readonly database: Database,
    private readonly cipher: FieldCipher,
  ) {}

  async find(scope: IdempotencyScope): Promise<StoredIdempotencyRecord | null> {
    const [record] = await this.database
      .select()
      .from(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.actorKey, scope.actorKey),
          eq(idempotencyRecords.operation, scope.operation),
          eq(idempotencyRecords.idempotencyKey, scope.key),
        ),
      )
      .limit(1);
    if (!record) return null;
    return {
      ...scope,
      requestHash: record.requestHash,
      responseStatus: record.responseStatus,
      responseBody: decryptResponse(record.responseBody, this.cipher),
      expiresAt: record.expiresAt,
    };
  }

  async tryCreate(record: StoredIdempotencyRecord): Promise<boolean> {
    const inserted = await this.database
      .insert(idempotencyRecords)
      .values({
        id: newId(),
        actorKey: record.actorKey,
        operation: record.operation,
        idempotencyKey: record.key,
        requestHash: record.requestHash,
        responseStatus: record.responseStatus,
        responseBody: record.responseBody,
        expiresAt: record.expiresAt,
      })
      .onConflictDoNothing()
      .returning({ id: idempotencyRecords.id });
    return inserted.length === 1;
  }

  async complete(scope: IdempotencyScope, status: number, body: unknown): Promise<void> {
    await this.database
      .update(idempotencyRecords)
      .set({ responseStatus: status, responseBody: { encrypted: this.cipher.encrypt(JSON.stringify(body)) } })
      .where(
        and(
          eq(idempotencyRecords.actorKey, scope.actorKey),
          eq(idempotencyRecords.operation, scope.operation),
          eq(idempotencyRecords.idempotencyKey, scope.key),
        ),
      );
  }

  async deleteExpired(now: Date): Promise<number> {
    const deleted = await this.database
      .delete(idempotencyRecords)
      .where(lt(idempotencyRecords.expiresAt, now))
      .returning({ id: idempotencyRecords.id });
    return deleted.length;
  }

  async abandon(scope: IdempotencyScope): Promise<void> {
    await this.database
      .delete(idempotencyRecords)
      .where(
        and(
          eq(idempotencyRecords.actorKey, scope.actorKey),
          eq(idempotencyRecords.operation, scope.operation),
          eq(idempotencyRecords.idempotencyKey, scope.key),
          isNull(idempotencyRecords.responseStatus),
        ),
      );
  }
}

function decryptResponse(value: unknown, cipher: FieldCipher): unknown {
  if (
    typeof value === 'object' &&
    value !== null &&
    'encrypted' in value &&
    typeof value.encrypted === 'string'
  ) {
    return JSON.parse(cipher.decrypt(value.encrypted)) as unknown;
  }
  return value;
}
