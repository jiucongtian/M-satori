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
  endowment: z.string().max(30).optional(),
  resonance: z.enum(['高', '中', '低']).optional(),
  xiaosui: z.object({ mood: z.enum(['listening', 'explaining', 'encouraging']).default('explaining'), intro: z.string().max(30) }).optional(),
  sections: z.array(z.object({
    code: z.string().min(1).max(30), title: z.string().min(1).max(30),
    tip: z.string().min(1).max(600), source: z.string().min(1).max(600),
    actions: z.array(z.string().min(1).max(160)).min(1).max(5),
  })).length(5).optional(),
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
    providerRequestId?: string;
    workflowId?: string;
    workflowVersion?: string;
    skillVersion?: string;
  };
}
export interface DailyInsightGenerator {
  generate(input: DailyInsightGenerationInput): Promise<DailyInsightGenerationResult>;
}
export function validateDailyInsightResult(
  result: DailyInsightGenerationResult,
): DailyInsightGenerationResult {
  DailyInsightContentSchema.parse(result.content);
  if (/诊断|保证|必然|投资建议|医疗建议/u.test(JSON.stringify(result.content)))
    throw Object.assign(new Error('Generated content failed safety validation'), {
      code: 'DAILY_INSIGHT_SAFETY_REJECTED',
      retryable: false,
    });
  return result;
}
