import { describe, expect, it } from 'vitest';
import { CursorCodec, InvalidCursorError, normalizePageLimit } from './cursor.js';

describe('opaque cursor', () => {
  it('round trips and rejects tampering', () => {
    const codec = new CursorCodec('0123456789abcdef');
    const encoded = codec.encode({ createdAt: '2026-08-10T00:00:00.000Z', id: 'id-1' });
    expect(codec.decode(encoded).id).toBe('id-1');
    expect(() => codec.decode(`${encoded}x`)).toThrow(InvalidCursorError);
  });

  it('applies default and maximum page sizes', () => {
    expect(normalizePageLimit(undefined)).toBe(20);
    expect(normalizePageLimit(50)).toBe(50);
    expect(() => normalizePageLimit(51)).toThrow(RangeError);
  });
});
