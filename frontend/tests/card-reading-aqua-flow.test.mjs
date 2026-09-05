import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const flowPath = new URL("../src/features/reading/ReadingFlowScreen.tsx", import.meta.url);
const readingScreensPath = new URL("../src/features/reading/ReadingScreens.tsx", import.meta.url);
const legacyStylePath = new URL("../src/features/legacy/legacy.css", import.meta.url);
const globalStylePath = new URL("../app/globals.css", import.meta.url);
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
  const source = await readFile(readingScreensPath, "utf8");
  assert.doesNotMatch(source, /setTimeout|prototypeSections|live\s*=/);
  assert.match(source, /正在整理问事报告/);
  assert.doesNotMatch(source, /Aqua 正在整理问事报告|保存完整报告/);
  assert.match(source, /report\?\.report/);
  assert.match(source, /report\?\.title/);
  assert.match(source, /LiveReadingSections/);
});

test("READ-13 与 READ-15 的 1 至 5 张牌共用固定区域且报告展示牌位", async () => {
  const [source, styles, globalStyles] = await Promise.all([readFile(readingScreensPath, "utf8"), readFile(legacyStylePath, "utf8"), readFile(globalStylePath, "utf8")]);
  assert.match(styles, /generation-card-stage,\.reading-report-scroll>\.report-card-gallery\{[^}]*height:clamp\(380px,55svh,430px\)[^}]*display:grid[^}]*grid-template-columns:repeat\(6/);
  assert.match(styles, /generation-card-stage\.count-4 figure:nth-child\(3\)[^{]*\{grid-column:1\/4!important;grid-row:2\}/);
  assert.match(styles, /generation-card-stage\.count-5 figure:nth-child\(4\)[^{]*\{grid-column:2\/4!important;grid-row:2\}/);
  assert.match(styles, /count-1\{--reading-card-width:162px\}/);
  assert.match(styles, /count-2\{--reading-card-width:136px\}/);
  assert.match(styles, /count-3\{--reading-card-width:106px\}/);
  assert.match(styles, /count-4\{--reading-card-width:92px\}/);
  assert.match(styles, /count-5\{--reading-card-width:88px\}/);
  assert.match(styles, /report-card-gallery figcaption\{position:static;[^}]*background:transparent/);
  assert.match(source, /<figcaption><strong>\{card\.positionLabel\}<\/strong><\/figcaption>/);
  assert.doesNotMatch(source, /<small>\{card\.displayName\}<\/small>/);
  assert.match(source, /reportStoryTitles/);
  assert.match(source, /report-sections continuous/);
  assert.match(styles, /report-section-content p\{[^}]*font-size:14px;line-height:1\.82/);
  assert.match(globalStyles, /font-family:"Fresh Noto Serif SC"/);
  assert.match(globalStyles, /font-family:"Fresh Noto Sans SC"/);
  assert.doesNotMatch(source, /slice\(0,9\)|继续阅读下一节|`继续看见 · \$\{index\+1\}`/);
});

test("问事接口类型包含完整 Aqua 报告", async () => {
  const source = await readFile(clientPath, "utf8");
  assert.match(source, /export type CardReadingReport/);
  assert.match(source, /export type CardReading = Schemas\["CardReading"\]/);
  const contract = await readFile(new URL("../src/api/contracts/generated.ts", import.meta.url), "utf8");
  assert.match(contract, /report: components\["schemas"\]\["CardReadingReport"\] \| null/);
  assert.match(source, /completeCardReading[\s\S]*?body: JSON\.stringify\(\{\}\)/);
  assert.match(source, /retryCardReading[\s\S]*?body: JSON\.stringify\(\{\}\)/);
});
