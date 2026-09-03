export type CardReadingAudience = 'B' | 'C';
export type CardReadingMode = 'single' | 'dual' | 'multi';

export type CardReadingContextValue =
  | string
  | number
  | boolean
  | null
  | readonly CardReadingContextValue[]
  | { readonly [key: string]: CardReadingContextValue };

interface CardReadingInputBase {
  readonly audience: CardReadingAudience;
  readonly question: string;
  readonly context?: Readonly<Record<string, CardReadingContextValue>>;
}

export type CardReadingInput =
  | (CardReadingInputBase & {
      readonly cards: readonly number[];
      readonly random_count?: never;
    } & Record<string, unknown>)
  | (CardReadingInputBase & {
      readonly cards?: never;
      readonly random_count: number;
    } & Record<string, unknown>);

/**
 * Aqua 的卡牌问事结果至少包含由工作流裁定的模式。其余报告字段由工作流输出
 * Schema 管理，Satori 在不丢字段的前提下透传。
 */
export type CardReadingResult = {
  readonly audience: CardReadingAudience;
  readonly cards: readonly number[];
  readonly missing_fields: readonly string[];
  readonly mode: CardReadingMode;
  readonly notice: string;
  readonly question_type: string;
  readonly report: string;
  readonly status: string;
  readonly title: string;
};

export interface CardReadingWorkflowExecution {
  readonly result: CardReadingResult;
  readonly requestId: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}
