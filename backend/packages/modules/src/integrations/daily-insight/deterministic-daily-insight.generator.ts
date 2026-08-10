import type {
  DailyInsightGenerator,
  DailyInsightGenerationInput,
  DailyInsightGenerationResult,
} from '@satori/application';

export class DeterministicDailyInsightGenerator implements DailyInsightGenerator {
  generate(input: DailyInsightGenerationInput): Promise<DailyInsightGenerationResult> {
    const themes = ['保持清晰的边界', '留意当下的节奏', '把注意力带回自己', '在关系中保持坦诚'];
    const seed = [...`${input.profileRevisionId}:${input.localDate}`].reduce(
      (sum, value) => sum + value.charCodeAt(0),
      0,
    );
    const theme = themes[seed % themes.length]!;
    return Promise.resolve({
      content: {
        theme,
        insight: `今天适合围绕“${theme}”观察自己的感受与选择，不急于给经历下结论。`,
        action: '今天选择一件真正重要的小事，并为它留出完整时间。',
        reflectionQuestion: '今天什么事情最值得你投入注意力？',
        notice: '内容用于自我观察与成长参考。',
      },
      manifest: {
        generator: 'DETERMINISTIC_STUB',
        modelVersion: 'stub/1.0',
        promptVersion: 'daily-insight/1.0',
        knowledgeVersion: 'knowledge/2026-08-10',
        schemaVersion: 'daily-insight/1.0',
        contentPolicyVersion: 'r1.0',
        generatedAt: new Date().toISOString(),
      },
    });
  }
}
