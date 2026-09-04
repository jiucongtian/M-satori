import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROTECTED_PATHS, ROUTES } from "../../src/shared/routes.ts";

test("R11-READ-001：问事入口、发起页和历史页是受保护的真实路由", () => {
  for (const path of [ROUTES.readings, ROUTES.readingNew, ROUTES.readingHistory]) {
    assert.equal(PROTECTED_PATHS.has(path), true, `${path} 必须受登录保护`);
  }
  assert.equal(ROUTES.readings, "/readings");
  assert.equal(ROUTES.readingNew, "/readings/new");
  assert.equal(ROUTES.readingHistory, "/readings/history");
});

test("R11-READ-002：问事首页的两个入口都进入问题填写页", async () => {
  const page = await readFile(new URL("../../src/features/reading/ReadingHomeScreen.tsx", import.meta.url), "utf8");
  const newRoute = "router.push(ROUTES.readingNew)";
  assert.equal((page.match(new RegExp(newRoute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length >= 2, true);
  assert.match(page, /router\.push\(ROUTES\.readingHistory\)/);
});

test("R11-READ-002：问题与牌位输入遵守边界，并提示下一步权益确认", async () => {
  const page = await readFile(new URL("../../src/features/reading/ReadingNewScreen.tsx", import.meta.url), "utf8");
  assert.match(page, /maxLength=\{120\}/);
  assert.match(page, /const ready=question\.trim\(\)\.length>=6/);
  assert.match(page, /disabled=\{!ready\}/);
  assert.match(page, /下一步确认本次使用的问事权益/);
});

test("R11-READ-003：风险问题提供安全替代表达与专业求助提醒", async () => {
  const flow = await readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /这个问题需要换一种[\s\S]*更安全的问法/);
  assert.match(flow, /不能代替医疗诊断、投资决策、法律意见/);
  assert.match(flow, /使用建议问法继续/);
});

test("R11-READ-004：牌数、牌位与随机抽牌规则在前端明确呈现", async () => {
  const flow = await readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /选择一张、两张或多张/);
  assert.match(flow, /两张牌的位置确认后/);
  assert.match(flow, /系统公平随机抽取/);
});

test("R11-READ-005：权益消耗、失败不重复提交与后端幂等契约均有边界", async () => {
  const flow = await readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  const contract = JSON.parse(await readFile(new URL("../../../backend/openapi/r1.1-p0-contract.json", import.meta.url), "utf8"));
  assert.match(flow, /只有形成有效问事报告才会核销/);
  assert.match(flow, /生成失败不会消耗权益，也不会重复提交/);
  assert.equal(contract.paths["/v1/readings/{readingId}/generate"].post["x-idempotency-required"], true);
});

test("R11-READ-006：权益不足时给出服务包入口，且返回路径可恢复", async () => {
  const flow = await readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  const routeFlow = await readFile(new URL("../../src/features/reading/ReadingFlowScreen.tsx", import.meta.url), "utf8");
  assert.match(flow, /ReadingInsufficient/);
  assert.match(flow, /onRecharge/);
  assert.match(routeFlow, /ROUTES\.shop/);
});

test("R11-READ-007：确认的卡牌被固定，失败重试沿用原卡牌", async () => {
  const flow = await readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /这 .* 张牌将冻结并用于生成报告/);
  assert.match(flow, /本次输入即将冻结/);
  assert.match(flow, /使用原卡牌重新生成/);
});

test("R11-READ-008：生成失败与网络中断都具有安全恢复路径", async () => {
  const flow = await readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /查看生成失败状态/);
  assert.match(flow, /查看网络中断状态/);
  assert.match(flow, /问题、卡牌和抽取结果都已安全保存/);
});

test("R11-READ-009：报告完成后可回到问事首页，记录保留后续查看入口", async () => {
  const flow = await readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /完成后会保存在问事记录中/);
  assert.match(flow, /稍后从问事记录查看/);
});

test("R11-READ-010：问事记录提供历史页与完成任务恢复提示", async () => {
  const home = await readFile(new URL("../../src/features/reading/ReadingHomeScreen.tsx", import.meta.url), "utf8");
  const history = await readFile(new URL("../../src/features/reading/ReadingHistoryScreen.tsx", import.meta.url), "utf8");
  assert.match(home, /ROUTES\.readingHistory/);
  assert.match(history, /待处理的任务也会在这里恢复/);
  assert.match(history, /生成中/);
  assert.match(history, /pageshow/);
  assert.match(history, /visibilitychange/);
});

test("R11-READ-011：问事分享默认隐藏原始问题，并提供生成失败恢复", async () => {
  const flow = await readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  assert.match(flow, /默认保护你的原始问题/);
  assert.match(flow, /隐藏问题/);
  assert.match(flow, /查看生成失败/);
});

test("R11-READ-012：所有问事页头展示后端智慧种子余额，不展示不可操作的权益或固定数字", async () => {
  const [shell, flow, balanceHook] = await Promise.all([
    readFile(new URL("../../src/features/reading/ReadingShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../src/features/reading/useWisdomSeedBalance.ts", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /useWisdomSeedBalance\(\)/);
  assert.match(flow, /function ReadingHeader[\s\S]{0,500}useWisdomSeedBalance\(\)/);
  assert.match(balanceHook, /api\.seedAccount\(\)/);
  assert.match(balanceHook, /account\.available/);
  assert.match(balanceHook, /visibilitychange/);
  assert.doesNotMatch(shell, /<i>权益<\/i>/);
  assert.doesNotMatch(flow, /className="mini-balance"><i>●<\/i>2/);
  assert.doesNotMatch(flow, /智慧种子 <b>-2<\/b>|本次 2 颗种子|当前余额 <b>1 ●<\/b>/);
});
