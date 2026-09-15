import assert from "node:assert/strict";
import test from "node:test";
import { createOrRetryDailyInsight } from "../src/features/daily/dailyRetry.ts";

test("失败任务先重新排队再恢复轮询，保留原任务身份", async () => {
  const result = { dailyInsight: { status: "FAILED", taskId: "original" }, task: null };
  const calls = [];
  let unblock;
  const queued = new Promise(resolve => { unblock = resolve; });
  let completed = false;
  const pending = createOrRetryDailyInsight({
    createTodayInsight: async () => result,
    retryGenerationTask: async id => { calls.push(id); await queued; },
  }).then(value => { completed = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ["original"]);
  assert.equal(completed, false);
  unblock();
  assert.equal(await pending, result);
});

test("成功和进行中的任务不重复入队", async () => {
  for (const status of ["READY", "GENERATING", "PENDING"]) {
    await createOrRetryDailyInsight({
      createTodayInsight: async () => ({ dailyInsight: { status } }),
      retryGenerationTask: async () => assert.fail("unexpected retry"),
    });
  }
});

test("重试失败或任务缺失时保持错误状态，不假装正在生成", async () => {
  await assert.rejects(createOrRetryDailyInsight({
    createTodayInsight: async () => ({ dailyInsight: { status: "FAILED", taskId: "original" } }),
    retryGenerationTask: async () => { throw new Error("not retryable"); },
  }), /not retryable/);
  await assert.rejects(createOrRetryDailyInsight({
    createTodayInsight: async () => ({ dailyInsight: { status: "FAILED" } }),
    retryGenerationTask: async () => assert.fail("unexpected retry"),
  }), /未找到/);
});
