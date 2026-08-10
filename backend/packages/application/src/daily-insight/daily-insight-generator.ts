import { z } from 'zod';

export const DAILY_INSIGHT_GENERATOR = Symbol('DAILY_INSIGHT_GENERATOR');
export interface DailyInsightGenerationInput {
  dailyInsightId: string;
  localDate: string;
  timezone: string;
  profileRevisionId: string;
  astrologySnapshot: unknown;
  cards: unknown[];
}
export const DailyInsightContentSchema = z.object({
  theme: z.string().min(1).max(60),
  insight: z.string().min(1).max(600),
  action: z.string().min(1).max(200),
  reflectionQuestion: z.string().min(1).max(120),
  notice: z.literal('内容用于自我观察与成长参考。'),
});
export type DailyInsightContent = z.infer<typeof DailyInsightContentSchema>;
export interface DailyInsightGenerationResult {
  content: DailyInsightContent;
  manifest: {
    generator: string;
    modelVersion: string;
    promptVersion: string;
    knowledgeVersion: string;
    schemaVersion: string;
    contentPolicyVersion: string;
    generatedAt: string;
  };
}
export interface DailyInsightGenerator {
  generate(input: DailyInsightGenerationInput): Promise<DailyInsightGenerationResult>;
}
export function validateDailyInsightResult(
  result: DailyInsightGenerationResult,
): DailyInsightGenerationResult {
  DailyInsightContentSchema.parse(result.content);
  if (/诊断|保证|必然|投资建议|医疗建议/u.test(Object.values(result.content).join(' ')))
    throw Object.assign(new Error('Generated content failed safety validation'), {
      code: 'DAILY_INSIGHT_SAFETY_REJECTED',
      retryable: false,
    });
  return result;
}
