import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROTECTED_PATHS, ROUTES } from "../../src/shared/routes.ts";

// Source-wiring checks only. Real settlement/recovery tests live in backend/tests/integration.
const source = path => readFile(new URL(`../../src/${path}`, import.meta.url), "utf8");

test("R11-READ-001：正式问事入口、发起页和历史页需要登录", () => {
  for (const path of [ROUTES.readings, ROUTES.readingNew, ROUTES.readingHistory]) assert.equal(PROTECTED_PATHS.has(path), true);
});
test("R11-READ-002：新问事与历史入口接入正式路由", async () => {
  const page = await source("features/reading/ReadingHomeScreen.tsx");
  assert.match(page, /router\.push\(ROUTES\.readingNew\)/);
  assert.match(page, /router\.push\(ROUTES\.readingHistory\)/);
});
test("R11-READ-003：正式输入页提供输入边界及专业求助提示", async () => {
  const page = await source("features/reading/ReadingNewScreen.tsx");
  assert.match(page, /maxLength=\{120\}/);
  assert.match(page, /disabled=\{!ready\}/);
  assert.match(page, /不能代替医疗诊断、投资决策或法律意见/);
  assert.match(page, /如何照顾自己、理解感受并准备下一步/);
});
test("R11-READ-004：正式问事独立于原型并保留牌数与牌位", async () => {
  const page = await source("features/reading/ReadingNewScreen.tsx");
  const flow = await source("features/reading/ReadingFlowScreen.tsx");
  assert.match(page, /\[3,4,5\]/);
  assert.match(page, /positionTemplate/);
  assert.doesNotMatch(flow, /features\/legacy|ReadingPrototypeScreens/);
});
test("R11-READ-005：权益显示来自真实接口，抽牌发送稳定请求键", async () => {
  const payment = await source("features/reading/ReadingPaymentScreen.tsx");
  const flow = await source("features/reading/ReadingFlowScreen.tsx");
  assert.match(payment, /api\.resolveEntitlement/);
  assert.match(payment, /source\.cost/);
  assert.doesNotMatch(payment, /8 次|7 次/);
  assert.match(flow, /api\.createCardReadingDraw\([^]*?drawRequestKey\)/);
});
test("R11-READ-006：权益不足给出可返回的服务包入口", async () => {
  const payment = await source("features/reading/ReadingPaymentScreen.tsx");
  assert.match(payment, /当前可用权益不足/);
  assert.match(payment, /\/shop\?returnTo=/);
});
test("R11-READ-007：失败重试只发送原记录，不重新抽牌", async () => {
  const flow = await source("features/reading/ReadingFlowScreen.tsx");
  assert.match(flow, /api\.retryCardReading\(reading\.readingId\)/);
  assert.match(flow, /retried\.readingId,retried\.cardCount/);
});
test("R11-READ-008：网络错误、缺失记录和草稿均有恢复出口", async () => {
  const flow = await source("features/reading/ReadingFlowScreen.tsx");
  assert.match(flow, /setFlowError\(apiMessage\(reason\)\)/);
  assert.match(flow, /onRetry=\{\(\)=>window\.location\.reload\(\)\}/);
  assert.match(flow, /没有找到本次问事/);
  assert.match(flow, /问事草稿已失效/);
});
test("R11-READ-009：正式生成没有模拟成功定时器，报告包含反馈入口", async () => {
  const views = await source("features/reading/ReadingScreens.tsx");
  assert.doesNotMatch(views, /setTimeout|prototypeSections/);
  assert.match(views, /完成后会保存在问事记录中/);
  assert.match(views, /onFeedback&&/);
});
test("R11-READ-010：历史页面恢复待处理任务并响应页面重新可见", async () => {
  const history = await source("features/reading/ReadingHistoryScreen.tsx");
  assert.match(history, /待处理的任务也会在这里恢复/);
  assert.match(history, /pageshow/);
  assert.match(history, /visibilitychange/);
});
test("R11-READ-011：反馈保存接入后端并显示失败，不只修改本地状态", async () => {
  const feedback = await source("features/reading/ReadingFeedbackScreen.tsx");
  assert.match(feedback, /api\.cardReadingFeedback\(/);
  assert.match(feedback, /role="alert"/);
});
test("R11-READ-012：问事页头统一使用后端种子余额", async () => {
  const [shell, views, hook] = await Promise.all([source("features/reading/ReadingShell.tsx"), source("features/reading/ReadingScreens.tsx"), source("features/reading/useWisdomSeedBalance.ts")]);
  assert.match(shell, /useWisdomSeedBalance\(\)/);
  assert.match(views, /import \{ ReadingHeader \} from "\.\/ReadingShell"/);
  assert.match(hook, /api\.seedAccount\(\)/);
  assert.match(hook, /visibilitychange/);
});
