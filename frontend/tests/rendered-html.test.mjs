import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

test("服务端完整渲染 H5 原型欢迎页", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /R1\.1 · AUTH-02/);
  assert.match(html, /每一天，/);
  assert.match(html, /更懂自己一点/);
  assert.match(html, /开始认识自己/);
  assert.match(html, /已有档案/);
});

test("正式工程保留完整原型基础样式", async () => {
  const [formalCss, prototypeCss] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../../h5-prototype/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.ok(formalCss.startsWith(prototypeCss));
});

test("R1.1 主导航开放问事且成长、关系仍进入预告页", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const nav = page.match(/function MainNav[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(nav, /\["今日", 10/);
  assert.match(nav, /\["我的", 21/);
  assert.match(nav, /\["问事", profileSteps\.indexOf\("READ-01"\)/);
  assert.match(nav, /PREVIEW-GROWTH/);
  assert.match(nav, /PREVIEW-RELATIONSHIP/);
  assert.doesNotMatch(nav, /\["问事", profileSteps\.indexOf\("PREVIEW-READ"\)|\["成长", 43|\["关系", 44/);
});

test("R1.1 可达页面白名单包含完整问事且排除后续版本模块", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const scope = page.match(/const r1StepIds = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  for (const id of ["PROFILE-01", "PROFILE-11", "GIFT-01", "HOME-01", "DAILY-03", "MY-01", "MY-03", "MY-09", "MY-16"]) {
    assert.match(scope, new RegExp(`"${id}"`));
  }
  for (const id of ["READ-01","READ-02","READ-03","READ-04","READ-05","READ-06","READ-09","READ-10","READ-11","READ-12","READ-13","READ-14","READ-15","READ-18","READ-19","READ-20","READ-21","READ-22","READ-23","READ-24","READ-25"]) assert.match(scope,new RegExp(`"${id}"`));
  assert.match(scope, /PREVIEW-GROWTH/);
  assert.match(scope, /PREVIEW-RELATIONSHIP/);
  const withoutAllowed = scope.replaceAll(/"READ-[^"]+",?\s*/g, "").replaceAll("PREVIEW-READ", "").replaceAll("PREVIEW-GROWTH", "").replaceAll("PREVIEW-RELATIONSHIP", "");
  assert.doesNotMatch(withoutAllowed, /GRW-|REL-|LIFE-|PER-|SHOP-|GOODS-|ORDER-/);
});

test("R1.1 我的页面不展示后续版本入口", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const myHome = page.match(/function MyHome[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(myHome, /每日指引记录/);
  assert.match(myHome, /生命智慧档案库/);
  assert.match(myHome, /智慧种子/);
  assert.doesNotMatch(myHome, /商城|助学童子|生命之光|月运|年运|关系匹配/);
});

test("三个预告页统一说明后续上线与未来能力", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const preview = page.match(/function ComingSoonPage[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(preview, /这片新的枝叶正在生长/);
  assert.match(preview, /将在后续版本与你见面/);
  assert.match(preview, /未来将支持/);
  assert.match(preview, /我知道了，返回今日/);
});

test("预告页保持单屏且底部导航位置稳定", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.coming-soon-page\{[^}]*height:100%[^}]*overflow:hidden[^}]*display:flex/);
  assert.match(css, /\.today-home>\.main-nav,\.my-home>\.main-nav,\.coming-soon-page>\.main-nav\{[^}]*position:absolute[^}]*left:-9px[^}]*right:-9px[^}]*bottom:0[^}]*height:52px[^}]*grid-template-columns:repeat\(5,1fr\)/);
});

test("五个根页面切换时不重新执行整页入场动画", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /\.today-home,\.my-home\{animation:none\}/);
  assert.doesNotMatch(css, /\.coming-soon-page\{[^}]*animation:page-in/);
});

test("待后端能力具有明确候选契约", async () => {
  const support = await readFile(new URL("../src/api/contracts/support.ts", import.meta.url), "utf8");
  assert.match(support, /CONTRACT_PROPOSED/);
  assert.match(support, /profileLibrary/);
  assert.match(support, /registrationReward/);
  assert.match(support, /wisdomSeeds/);
  assert.match(support, /cardReading/);
});

test("R1.1 问事支持1至5张随机抽牌并按张数消耗智慧种子", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /\[3,4,5\]\.map/);
  assert.match(page, /系统公平随机抽取/);
  assert.match(page, /确认并种下 \$\{cardCount\} 颗智慧种子/);
  assert.doesNotMatch(page.match(/function MainNav[\s\S]*?\n}\n/)?.[0] ?? "", /PREVIEW-READ/);
});

test("R1.1 卡牌后端候选契约覆盖抽取、生成、历史、重试和反馈", async () => {
  const contract = await readFile(new URL("../src/api/contracts/card-reading.ts", import.meta.url), "utf8");
  for (const endpoint of ["/card-draws","/card-readings","/retry","/feedback"]) assert.match(contract,new RegExp(endpoint));
  assert.match(contract, /CONTRACT_PROPOSED/);
  assert.match(contract, /SYSTEM_RANDOM/);
  assert.match(contract, /cardCount: 1 \| 2 \| 3 \| 4 \| 5/);
});
