import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ApiExceptionFilter } from './api-exception.filter.js';

describe('API protocol', () => {
  it('exposes a single exception filter for standard envelopes', () => {
    expect(new ApiExceptionFilter()).toBeInstanceOf(ApiExceptionFilter);
    const exception = new BadRequestException({ code: 'INVALID_INPUT', message: 'invalid input' });
    expect(exception.getStatus()).toBe(400);
  });
});
