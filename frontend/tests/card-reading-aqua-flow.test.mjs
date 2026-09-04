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

test("新问事不受旧活动记录牌数影响，失败重试显式携带原记录信息", async () => {
  const source = await readFile(flowPath, "utf8");
  assert.match(source, /canRestoreSaved=\["draw","reveal","generating","report","feedback","failure"\]\.includes\(step\)/);
  assert.match(source, /readingQuery=readingId\?`&readingId=\$\{encodeURIComponent\(readingId\)\}`/);
  assert.match(source, /cards=\$\{overrideCount\?\?cardCount\}/);
  assert.match(source, /go\("generating",retried\.readingId,retried\.cardCount\)/);
});

test("正式生成页不使用原型定时器并展示真实报告进度", async () => {
  const source = await readFile(legacyPath, "utf8");
  assert.match(source, /if\(live\)return;/);
  assert.match(source, /正在整理问事报告/);
  assert.doesNotMatch(source, /Aqua 正在整理问事报告|保存完整报告/);
  assert.match(source, /report\?\.report/);
  assert.match(source, /report\?\.title/);
  assert.match(source, /LiveReadingSections/);
});

test("问事接口类型包含完整 Aqua 报告", async () => {
  const source = await readFile(clientPath, "utf8");
  assert.match(source, /export type CardReadingReport/);
  assert.match(source, /report: CardReadingReport \| null/);
  assert.match(source, /completeCardReading[\s\S]*?body: JSON\.stringify\(\{\}\)/);
  assert.match(source, /retryCardReading[\s\S]*?body: JSON\.stringify\(\{\}\)/);
});
