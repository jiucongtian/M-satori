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

test.todo("R11-READ-003：问题安全边界与澄清分流");
test.todo("R11-READ-004：牌阵、随机抽牌与输入冻结");
test.todo("R11-READ-005：权益预占、核销与幂等");
test.todo("R11-READ-006：权益不足的保留与恢复");
test.todo("R11-READ-007：抽牌结果固定与失败重试不重抽");
test.todo("R11-READ-008：生成失败、网络中断与恢复");
test.todo("R11-READ-009：报告保存与成长报告库归档");
test.todo("R11-READ-010：问事历史筛选、续读与生成任务恢复");
test.todo("R11-READ-011：分享隐私与生成恢复");
