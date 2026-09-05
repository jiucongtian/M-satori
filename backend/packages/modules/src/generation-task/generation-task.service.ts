import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { IdempotencyService } from '@satori/application';
import {
  FieldCipher,
  generationAttempts,
  generationTasks,
  newId,
  outbox,
  PostgresIdempotencyStore,
  RuntimeInfrastructure,
  taskEvents,
} from '@satori/infrastructure';
import { and, asc, eq, gt, lt, max } from 'drizzle-orm';

type DatabaseTransaction = Parameters<Parameters<RuntimeInfrastructure['database']['transaction']>[0]>[0];

export interface CreateGenerationTaskCommand {
  ownerUserId: string;
  targetType: string;
  targetId: string;
  maxAttempts?: number;
}

@Injectable()
export class GenerationTaskService {
  private readonly idempotency: IdempotencyService;

  constructor(
    private readonly infrastructure: RuntimeInfrastructure,
    cipher: FieldCipher,
  ) {
    this.idempotency = new IdempotencyService(
      new PostgresIdempotencyStore(infrastructure.database, cipher),
      infrastructure.policy.idempotency.ttlSeconds * 1000,
    );
  }

  async create(command: CreateGenerationTaskCommand) {
    return this.infrastructure.database.transaction((tx) => this.createInTransaction(tx, command));
  }

  async createInTransaction(tx: DatabaseTransaction, command: CreateGenerationTaskCommand) {
    const id = newId();
    const [task] = await tx
      .insert(generationTasks)
      .values({
        id,
        ownerUserId: command.ownerUserId,
        targetType: command.targetType,
        targetId: command.targetId,
        maxAttempts: command.maxAttempts ?? this.infrastructure.policy.queue.maxAttempts,
      })
      .returning();
    await this.appendEvent(tx, id, 'generation.snapshot', this.taskDto(task!));
    await this.enqueueOutbox(tx, id, 'generation.task.requested');
    return this.taskDto(task!);
  }

  async getOwned(userId: string, taskId: string) {
    const [task] = await this.infrastructure.database
      .select()
      .from(generationTasks)
      .where(and(eq(generationTasks.id, taskId), eq(generationTasks.ownerUserId, userId)))
      .limit(1);
    if (!task)
      throw new NotFoundException({
        code: 'GENERATION_TASK_NOT_FOUND',
        message: 'Generation task not found',
      });
    return this.taskDto(task);
  }

  async retry(userId: string, taskId: string, idempotencyKey: string) {
    const result = await this.idempotency.execute(
      { actorKey: `user:${userId}`, operation: 'retryGenerationTask', key: idempotencyKey },
      { taskId },
      async () => {
        const body = await this.infrastructure.database.transaction(async (tx) => {
          const [task] = await tx
            .select()
            .from(generationTasks)
            .where(and(eq(generationTasks.id, taskId), eq(generationTasks.ownerUserId, userId)))
            .for('update')
            .limit(1);
          if (!task)
            throw new NotFoundException({
              code: 'GENERATION_TASK_NOT_FOUND',
              message: 'Generation task not found',
            });
          if (task.status === 'QUEUED' || task.status === 'RUNNING') {
            throw new ConflictException({
              code: 'GENERATION_TASK_ALREADY_RUNNING',
              message: 'Generation task is already running',
            });
          }
          const failure = task.failure as { retryable?: boolean } | null;
          if (task.status !== 'FAILED' || !failure?.retryable) {
            throw new ConflictException({
              code: 'GENERATION_TASK_NOT_RETRYABLE',
              message: 'Generation task is not retryable',
            });
          }
          if (task.currentAttempt >= task.maxAttempts) {
            throw new ConflictException({
              code: 'GENERATION_RETRY_LIMIT_REACHED',
              message: 'Generation retry limit reached',
            });
          }
          const now = new Date();
          const [updated] = await tx
            .update(generationTasks)
            .set({ status: 'QUEUED', stage: 'QUEUED', failure: null, terminalAt: null, updatedAt: now })
            .where(eq(generationTasks.id, task.id))
            .returning();
          await this.appendEvent(tx, task.id, 'generation.snapshot', this.taskDto(updated!));
          await this.enqueueOutbox(tx, task.id, 'generation.task.retry_requested');
          return this.taskDto(updated!);
        });
        return { status: 202, body };
      },
    );
    return result.body;
  }

  async claim(taskId: string) {
    return this.infrastructure.database.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(generationTasks)
        .where(eq(generationTasks.id, taskId))
        .for('update')
        .limit(1);
      if (!task || task.status === 'SUCCEEDED' || task.status === 'CANCELLED' || task.status === 'FAILED') return null;
      if (
        task.status === 'RUNNING' &&
        task.heartbeatAt &&
        Date.now() - task.heartbeatAt.getTime() < this.infrastructure.environment.QUEUE_JOB_TIMEOUT_MS
      )
        return null;
      if (task.currentAttempt >= task.maxAttempts) return null;
      const attemptNumber = task.currentAttempt + 1;
      const now = new Date();
      await tx
        .insert(generationAttempts)
        .values({ id: newId(), taskId, attemptNumber, status: 'RUNNING', startedAt: now })
        .onConflictDoNothing();
      const [updated] = await tx
        .update(generationTasks)
        .set({
          status: 'RUNNING',
          stage: 'PREPARING_PROFILE',
          currentAttempt: attemptNumber,
          heartbeatAt: now,
          failure: null,
          updatedAt: now,
        })
        .where(eq(generationTasks.id, taskId))
        .returning();
      await this.appendEvent(tx, taskId, 'generation.stage_changed', this.taskDto(updated!));
      return updated!;
    });
  }

  async heartbeat(taskId: string, stage?: string, expectedAttempt?: number) {
    return this.infrastructure.database.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(generationTasks)
        .where(eq(generationTasks.id, taskId))
        .for('update')
        .limit(1);
      if (!task || task.status !== 'RUNNING') return null;
      if (expectedAttempt !== undefined && task.currentAttempt !== expectedAttempt) return null;
      const now = new Date();
      const [updated] = await tx
        .update(generationTasks)
        .set({ heartbeatAt: now, updatedAt: now, ...(stage ? { stage } : {}) })
        .where(eq(generationTasks.id, taskId))
        .returning();
      if (stage && stage !== task.stage)
        await this.appendEvent(tx, taskId, 'generation.stage_changed', this.taskDto(updated!));
      return updated!;
    });
  }

  async succeed(taskId: string, expectedAttempt?: number) {
    return this.infrastructure.database.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(generationTasks)
        .where(eq(generationTasks.id, taskId))
        .for('update')
        .limit(1);
      if (!task || task.status === 'SUCCEEDED') return task ? this.taskDto(task) : null;
      if (task.status !== 'RUNNING') return null;
      if (expectedAttempt !== undefined && task.currentAttempt !== expectedAttempt) return null;
      const now = new Date();
      const [updated] = await tx
        .update(generationTasks)
        .set({ status: 'SUCCEEDED', stage: 'COMPLETED', terminalAt: now, heartbeatAt: now, updatedAt: now })
        .where(eq(generationTasks.id, taskId))
        .returning();
      await tx
        .update(generationAttempts)
        .set({ status: 'SUCCEEDED', finishedAt: now })
        .where(
          and(
            eq(generationAttempts.taskId, taskId),
            eq(generationAttempts.attemptNumber, task.currentAttempt),
          ),
        );
      await this.appendEvent(tx, taskId, 'generation.ready', this.taskDto(updated!));
      return this.taskDto(updated!);
    });
  }

  async failAttempt(
    taskId: string,
    error: { code: string; message: string; retryable: boolean },
    terminal: boolean,
    expectedAttempt?: number,
    recovery = false,
  ) {
    return this.infrastructure.database.transaction(async (tx) => {
      const [task] = await tx
        .select()
        .from(generationTasks)
        .where(eq(generationTasks.id, taskId))
        .for('update')
        .limit(1);
      if (!task || task.status === 'SUCCEEDED') return null;
      if (
        expectedAttempt !== undefined &&
        (task.currentAttempt !== expectedAttempt || task.status !== 'RUNNING')
      )
        return null;
      if (
        recovery &&
        (task.status !== 'RUNNING' ||
          !task.heartbeatAt ||
          task.heartbeatAt.getTime() >= Date.now() - this.infrastructure.environment.QUEUE_JOB_TIMEOUT_MS)
      )
        return null;
      const final = terminal || !error.retryable || task.currentAttempt >= task.maxAttempts;
      const now = new Date();
      const [updated] = await tx
        .update(generationTasks)
        .set({
          status: final ? 'FAILED' : 'QUEUED',
          stage: final ? 'FAILED' : 'RETRY_WAITING',
          failure: error,
          terminalAt: final ? now : null,
          heartbeatAt: now,
          updatedAt: now,
        })
        .where(eq(generationTasks.id, taskId))
        .returning();
      await tx
        .update(generationAttempts)
        .set({ status: 'FAILED', finishedAt: now, failure: error })
        .where(
          and(
            eq(generationAttempts.taskId, taskId),
            eq(generationAttempts.attemptNumber, task.currentAttempt),
          ),
        );
      await this.appendEvent(
        tx,
        taskId,
        final ? 'generation.failed' : 'generation.retry_waiting',
        this.taskDto(updated!),
      );
      if (recovery && !final) await this.enqueueOutbox(tx, taskId, 'generation.task.recovery_requested');
      return this.taskDto(updated!);
    });
  }

  async recoverStaleTasks() {
    const cutoff = new Date(Date.now() - this.infrastructure.environment.QUEUE_JOB_TIMEOUT_MS);
    const stale = await this.infrastructure.database
      .select({ id: generationTasks.id })
      .from(generationTasks)
      .where(and(eq(generationTasks.status, 'RUNNING'), lt(generationTasks.heartbeatAt, cutoff)));
    for (const task of stale)
      await this.failAttempt(
        task.id,
        { code: 'WORKER_HEARTBEAT_TIMEOUT', message: 'Worker heartbeat timed out', retryable: true },
        false,
        undefined,
        true,
      );
    return stale.length;
  }

  async listEvents(userId: string, taskId: string, lastEventId?: string) {
    await this.getOwned(userId, taskId);
    let lastSequence = 0;
    if (lastEventId) {
      const [event] = await this.infrastructure.database
        .select({ sequence: taskEvents.sequence })
        .from(taskEvents)
        .where(and(eq(taskEvents.id, lastEventId), eq(taskEvents.taskId, taskId)))
        .limit(1);
      lastSequence = event?.sequence ?? 0;
    }
    return this.infrastructure.database
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, taskId), gt(taskEvents.sequence, lastSequence)))
      .orderBy(asc(taskEvents.sequence));
  }

  async currentSnapshot(userId: string, taskId: string) {
    return this.getOwned(userId, taskId);
  }

  private async appendEvent(tx: DatabaseTransaction, taskId: string, eventType: string, payload: unknown) {
    const [position] = await tx
      .select({ value: max(taskEvents.sequence) })
      .from(taskEvents)
      .where(eq(taskEvents.taskId, taskId));
    const [event] = await tx
      .insert(taskEvents)
      .values({ id: newId(), taskId, sequence: (position?.value ?? 0) + 1, eventType, payload })
      .returning();
    try {
      await this.infrastructure.redis.publish(`generation-task:${taskId}`, event!.id);
    } catch {
      /* PostgreSQL polling remains authoritative. */
    }
    return event!;
  }

  private async enqueueOutbox(tx: DatabaseTransaction, taskId: string, eventType: string) {
    await tx.insert(outbox).values({
      id: newId(),
      aggregateType: 'GENERATION_TASK',
      aggregateId: taskId,
      eventType,
      payload: { taskId },
    });
  }

  taskDto(task: typeof generationTasks.$inferSelect) {
    const status =
      task.status === 'QUEUED'
        ? 'PENDING'
        : task.status === 'RUNNING'
          ? 'GENERATING'
          : task.status === 'SUCCEEDED'
            ? 'READY'
            : 'FAILED';
    return {
      taskId: task.id,
      type: `${task.targetType}_GENERATION`,
      status,
      stage: task.stage,
      stageLabel: this.stageLabel(task.stage),
      canRetry:
        task.status === 'FAILED' &&
        Boolean((task.failure as { retryable?: boolean } | null)?.retryable) &&
        task.currentAttempt < task.maxAttempts,
      target: { type: task.targetType, id: task.targetId },
      failure: task.failure,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      completedAt: task.terminalAt?.toISOString() ?? null,
    };
  }

  private stageLabel(stage: string) {
    return (
      (
        {
          QUEUED: '内容正在排队',
          PREPARING_PROFILE: '正在整理档案信息',
          PREPARING_CONTEXT: '正在准备今日上下文',
          GENERATING_CONTENT: '正在生成内容',
          VALIDATING_CONTENT: '正在检查内容一致性',
          FINALIZING: '内容即将完成',
          COMPLETED: '内容已完成',
          RETRY_WAITING: '暂时中断，正在重试',
          FAILED: '生成未完成',
        } as Record<string, string>
      )[stage] ?? stage
    );
  }
}
