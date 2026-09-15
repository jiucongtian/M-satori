/** Manual recovery only: Aqua confirmed daily-insight version resources repaired.
 * Keep the original task/target identity; this does not enable automatic retry.
 */
export function canManuallyRetryGeneration(task: {
  status: string;
  targetType: string;
  failure: unknown;
}): boolean {
  if (task.status !== 'FAILED') return false;
  const failure = task.failure as { code?: string; retryable?: boolean } | null;
  if (failure?.code === 'IDEMPOTENCY_CONFLICT') return false;
  return failure?.retryable === true || (
    task.targetType === 'DAILY_INSIGHT' && failure?.code === 'SKILL_VERSION_MISMATCH'
  );
}
