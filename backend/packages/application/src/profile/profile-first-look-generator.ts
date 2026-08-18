export type ProfileFirstLookStatus = 'complete' | 'partial';
export type ProfileFirstLookPosition = 'hour' | 'day' | 'month' | 'year';

export interface ProfileFirstLookGenerationInput {
  idempotencyKey: string;
  runReference: string;
  name?: string;
  pronoun: '你';
  cards: Record<ProfileFirstLookPosition, string>;
}

export interface ProfileFirstLookCard {
  position: ProfileFirstLookPosition;
  dimension: '思想' | '行为' | '事业' | '梦想目标';
  card: string;
  title: string;
  summary: string;
  innerTrait: string;
  outerTrait: string;
  status: ProfileFirstLookStatus;
  evidence: Record<string, string>;
  missingFields: string[];
}

export interface ProfileFirstLookContent {
  schemaVersion: '1.0.0';
  status: ProfileFirstLookStatus;
  profileSummary: {
    title: string;
    description: string;
    keywords: string[];
    outerTrait: string;
    innerTrait: string;
  };
  cards: ProfileFirstLookCard[];
  knowledgeRelease: string;
  notice: '这是一份基础认识，不是对你人生的定论。';
}

export interface ProfileFirstLookManifest {
  workflowVersion: 'profile-four-card-first-look/1.0.5';
  skillVersion: '1.0.0-aqua.2';
  model: string;
  promptVersion: string;
  outputSchemaVersion: string;
  contentPolicyVersion: string;
}

export interface ProfileFirstLookGenerationResult {
  content: ProfileFirstLookContent;
  manifest: ProfileFirstLookManifest;
  providerRequestId: string;
  providerExecutionId: string | null;
  durationMs: number;
}

export interface ProfileFirstLookGenerator {
  generate(input: ProfileFirstLookGenerationInput): Promise<ProfileFirstLookGenerationResult>;
}

export const PROFILE_FIRST_LOOK_GENERATOR = Symbol('PROFILE_FIRST_LOOK_GENERATOR');
