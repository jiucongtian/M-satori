import { createHmac, timingSafeEqual } from 'node:crypto';

export interface CursorPosition {
  createdAt: string;
  id: string;
}

export class InvalidCursorError extends Error {
  readonly code = 'INVALID_CURSOR';
}

export class CursorCodec {
  constructor(private readonly secret: string) {}

  encode(position: CursorPosition): string {
    const payload = Buffer.from(JSON.stringify(position)).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  decode(cursor: string): CursorPosition {
    const [payload, suppliedSignature, extra] = cursor.split('.');
    if (!payload || !suppliedSignature || extra) throw new InvalidCursorError('Malformed cursor');
    const expectedSignature = this.sign(payload);
    const supplied = Buffer.from(suppliedSignature);
    const expected = Buffer.from(expectedSignature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new InvalidCursorError('Invalid cursor signature');
    }
    try {
      const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<CursorPosition>;
      if (typeof value.createdAt !== 'string' || typeof value.id !== 'string') throw new Error('shape');
      return { createdAt: value.createdAt, id: value.id };
    } catch {
      throw new InvalidCursorError('Invalid cursor payload');
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }
}

export function normalizePageLimit(value: number | undefined, defaultLimit = 20, maximum = 50): number {
  if (value === undefined) return defaultLimit;
  if (!Number.isInteger(value) || value < 1 || value > maximum) throw new RangeError('limit out of range');
  return value;
}
