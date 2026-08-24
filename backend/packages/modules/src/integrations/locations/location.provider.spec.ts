import { describe, expect, it } from 'vitest';
import { LocalLocationProvider, WORLD_CITY_CATALOG_VERSION } from './location.provider.js';

describe('world city location provider', () => {
  const provider = new LocalLocationProvider();

  it('searches Chinese prefecture cities by localized and romanized names', async () => {
    const localized = await provider.search('杭州', 5);
    const romanized = await provider.search('Hangzhou', 5);

    expect(localized[0]).toMatchObject({
      locationId: 'geonames:1808926',
      countryCode: 'CN',
      timezone: 'Asia/Shanghai',
      coordinates: { latitude: 30.29365, longitude: 120.16142 },
    });
    expect(localized[0]?.displayName).toContain('浙江省');
    expect(romanized[0]?.locationId).toBe('geonames:1808926');
  });

  it('searches foreign cities with their IANA timezone and administrative area', async () => {
    const results = await provider.search('London', 10);
    const london = results.find((location) => location.locationId === 'geonames:2643743');

    expect(london).toMatchObject({
      countryCode: 'GB',
      timezone: 'Europe/London',
      administrativePath: ['England', '伦敦'],
    });
  });

  it('supports legacy R1 location IDs while returning the canonical catalog record', async () => {
    await expect(provider.get('loc_cn_330100')).resolves.toMatchObject({
      locationId: 'geonames:1808926',
      timezone: 'Asia/Shanghai',
    });
  });

  it('returns null for unknown IDs and publishes a pinned catalog version', async () => {
    await expect(provider.get('missing')).resolves.toBeNull();
    expect(WORLD_CITY_CATALOG_VERSION).toMatch(/^world-cities\/[0-9a-f]{12}\+geonames$/u);
  });
});
