type DailyCommand = {
  dailyInsight: { status: string; taskId?: string | null };
  task?: { taskId: string } | null;
};

/** Wait for the original task to be requeued before the screen resumes polling. */
export async function createOrRetryDailyInsight<T extends DailyCommand>(client: {
  createTodayInsight(): Promise<T>;
  retryGenerationTask(taskId: string): Promise<unknown>;
}): Promise<T> {
  const result = await client.createTodayInsight();
  if (result.dailyInsight.status === "FAILED") {
    const taskId = result.task?.taskId ?? result.dailyInsight.taskId;
    if (!taskId) throw new Error("未找到可重试的今日指引任务，请刷新页面后再试。");
    await client.retryGenerationTask(taskId);
  }
  return result;
}
