import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const flowPath = new URL("../src/features/reading/ReadingFlowScreen.tsx", import.meta.url);
const legacyPath = new URL("../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url);
const clientPath = new URL("../src/api/client.ts", import.meta.url);

test("正式问事流程启动真实生成并轮询后端状态", async () => {
  const source = await readFile(flowPath, "utf8");
  assert.match(source, /api\.completeCardReading\(reading\.readingId\)/);
  assert.match(source, /api\.cardReading\(reading\.readingId\)/);
  assert.match(source, /window\.setInterval/);
  assert.match(source, /reading\.status==="READY"/);
  assert.match(source, /reading\.status==="FAILED"/);
});

test("正式生成页不使用原型定时器并展示 Aqua 真实报告", async () => {
  const source = await readFile(legacyPath, "utf8");
  assert.match(source, /if\(live\)return;/);
  assert.match(source, /Aqua 正在整理问事报告/);
  assert.match(source, /report\?\.report/);
  assert.match(source, /report\?\.title/);
});

test("问事接口类型包含完整 Aqua 报告", async () => {
  const source = await readFile(clientPath, "utf8");
  assert.match(source, /export type CardReadingReport/);
  assert.match(source, /report: CardReadingReport \| null/);
});
