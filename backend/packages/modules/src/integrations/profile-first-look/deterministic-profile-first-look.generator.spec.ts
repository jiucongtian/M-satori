import { describe, expect, it } from 'vitest';
import { DeterministicProfileFirstLookGenerator } from './deterministic-profile-first-look.generator.js';

const generator = new DeterministicProfileFirstLookGenerator();

describe('DeterministicProfileFirstLookGenerator', () => {
  it('builds a complete four-card report without an external workflow', async () => {
    const result = await generator.generate({
      idempotencyKey: 'profile-first-look-local-01',
      runReference: 'profile-11-local-01',
      name: '小满',
      pronoun: '你',
      cards: { hour: '甲子', day: '乙酉', month: '辛巳', year: '庚午' },
    });

    expect(result.content.status).toBe('complete');
    expect(result.content.cards.map((card) => [card.position, card.dimension, card.card])).toEqual([
      ['hour', '思想', '甲子'],
      ['day', '行为', '乙酉'],
      ['month', '事业', '辛巳'],
      ['year', '梦想目标', '庚午'],
    ]);
    expect(result.content.cards[0]?.summary).not.toContain('情绪化');
    expect(result.content.cards.every((card) => card.missingFields.length === 0)).toBe(true);
    expect(result.content.knowledgeRelease).toBe('lianshanyi-profile/1.0.0');
    expect(result.manifest).toMatchObject({
      generator: 'deterministic',
      workflowVersion: 'profile-four-card-first-look/local-1.0.0',
      ruleVersion: 'profile-season-rules/1.0.0',
    });
    expect(result.providerRequestId).toBe('local:profile-11-local-01');
  });

  it('uses the documented day-card fallback for a balanced five-season distribution', async () => {
    const result = await generator.generate({
      idempotencyKey: 'profile-first-look-balanced-01',
      runReference: 'profile-11-balanced-01',
      pronoun: '你',
      cards: { hour: '甲子', day: '丙申', month: '戊子', year: '庚午' },
    });

    expect(result.content.profileSummary.title).toBe('多种节律并存的生命底色');
    expect(result.content.profileSummary.description).toContain('回到自己时，你擅长观察、整理和判断');
    expect(result.content.profileSummary.description).toContain('真正回到自己时，你更接近冬的节奏');
    expect(result.content.profileSummary.description).toContain('面对外界时，则更容易展现夏的气质');
    expect(result.content.profileSummary.description).toContain('自然反差');
  });

  it('produces the same content for the same four cards', async () => {
    const input = {
      idempotencyKey: 'profile-first-look-repeat-01',
      runReference: 'profile-11-repeat-01',
      pronoun: '你' as const,
      cards: { hour: '甲寅', day: '甲寅', month: '甲寅', year: '甲寅' },
    };
    const first = await generator.generate(input);
    const second = await generator.generate(input);

    expect(second.content).toEqual(first.content);
    expect(first.content.profileSummary.title).toBe('春意鲜明的生命底色');
  });
});
