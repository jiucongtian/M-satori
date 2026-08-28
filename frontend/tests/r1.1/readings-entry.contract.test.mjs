import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function readProductSource(relativePath, context) {
  try {
    return await readFile(new URL(`../../src/${relativePath}`, import.meta.url), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      context.skip("R1.1 产品源码尚未合入 release/r1.1；该用例不能计为通过");
      return null;
    }
    throw error;
  }
}

test("R11-READ-001：问事入口、发起页和历史页是受保护的真实路由", async (context) => {
  const routes = await readProductSource("shared/routes.ts", context);
  if (!routes) return;
  for (const path of ["/readings", "/readings/new", "/readings/history"]) assert.match(routes, new RegExp(`"${path}"`));
  assert.match(routes, /PROTECTED_PATHS/);
});

test("R11-READ-002：问事首页的两个入口都进入问题填写页", async (context) => {
  const page = await readProductSource("features/reading/ReadingHomeScreen.tsx", context);
  if (!page) return;
  const newRoute = "router.push(ROUTES.readingNew)";
  assert.equal((page.match(new RegExp(newRoute.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) ?? []).length >= 2, true);
  assert.match(page, /router\.push\(ROUTES\.readingHistory\)/);
});

test("R11-READ-002：问题输入遵守长度边界，未完成的后续阶段会明确提示", async (context) => {
  const page = await readProductSource("features/reading/ReadingNewScreen.tsx", context);
  if (!page) return;
  assert.match(page, /maxLength=\{120\}/);
  assert.match(page, /disabled=\{question\.trim\(\)\.length<6\}/);
  assert.match(page, /下一阶段将接入问题澄清、牌阵配置与权益确认路由/);
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
