import type { RuntimeInfrastructure } from '@satori/infrastructure';
import { describe, expect, it } from 'vitest';
import { AquaClientFactory } from './aqua-client.factory.js';

describe('AquaClientFactory', () => {
  it('reuses one safe client for each timeout policy', () => {
    const infrastructure = {
      environment: {
        AQUA_BASE_URL: 'https://aqua.example.com',
        AQUA_SERVICE_KEY: 'test-service-key-with-safe-length',
      },
    } as RuntimeInfrastructure;
    const factory = new AquaClientFactory(infrastructure);

    expect(factory.create()).toBe(factory.create());
    expect(factory.create({ timeoutMs: 15_000 })).toBe(factory.create({ timeoutMs: 15_000 }));
    expect(factory.create()).not.toBe(factory.create({ timeoutMs: 15_000 }));
  });
});
