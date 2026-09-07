import { describe, expect, it, vi } from 'vitest';
import { verificationCodeForMode } from './sms-challenge.service.js';

describe('verificationCodeForMode', () => {
  it('keeps the documented deterministic code only in fixed-code mode', () => {
    const randomInteger = vi.fn(() => 42);

    expect(verificationCodeForMode('FIXED_CODE', randomInteger)).toBe('123456');
    expect(randomInteger).not.toHaveBeenCalled();
  });

  it.each(['GATEWAY', 'TENCENT_CLOUD'] as const)('generates a random six-digit code in %s mode', (mode) => {
    expect(verificationCodeForMode(mode, () => 42)).toBe('000042');
  });
});
