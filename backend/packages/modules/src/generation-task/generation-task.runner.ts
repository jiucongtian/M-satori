import { Injectable } from '@nestjs/common';

export type GenerationHandler = (task: { id: string; targetType: string; targetId: string }) => Promise<void>;
export type GenerationFailureHandler = (taskId: string, targetId: string) => Promise<void>;

@Injectable()
export class GenerationTaskRunner {
  private readonly handlers = new Map<string, GenerationHandler>();
  private readonly failureHandlers = new Map<string, GenerationFailureHandler>();

  register(targetType: string, handler: GenerationHandler, onFinalFailure?: GenerationFailureHandler) {
    this.handlers.set(targetType, handler);
    if (onFinalFailure) this.failureHandlers.set(targetType, onFinalFailure);
  }

  async run(task: { id: string; targetType: string; targetId: string }) {
    const handler = this.handlers.get(task.targetType);
    if (!handler) {
      const error = new Error(`No generation handler registered for ${task.targetType}`);
      Object.assign(error, { code: 'GENERATION_HANDLER_UNAVAILABLE', retryable: true });
      throw error;
    }
    await handler(task);
  }

  async finalFailure(targetType: string, taskId: string, targetId: string) {
    await this.failureHandlers.get(targetType)?.(taskId, targetId);
  }
}
