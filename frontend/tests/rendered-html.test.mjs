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
  assert.match(html, /R1\.0 · AUTH-02/);
  assert.match(html, /每一天，/);
  assert.match(html, /更懂自己一点/);
  assert.match(html, /开始认识自己/);
  assert.match(html, /已有档案/);
});

test("正式工程包含完整原型基础样式", async () => {
  const formalCss = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  for (const selector of [".stage", ".phone", ".hero-copy", ".login-page", ".profile-flow", ".today-home", ".my-home"]) {
    assert.match(formalCss, new RegExp(selector.replace(".", "\\.")));
  }
  assert.ok(formalCss.length > 50_000);
});

test("R1.0 主导航展示五项且三个未来模块只进入预告页", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const nav = page.match(/function MainNav[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.match(nav, /\["今日", 10/);
  assert.match(nav, /\["我的", 21/);
  assert.match(nav, /PREVIEW-READ/);
  assert.match(nav, /PREVIEW-GROWTH/);
  assert.match(nav, /PREVIEW-RELATIONSHIP/);
  assert.doesNotMatch(nav, /\["问事", 29|\["成长", 43|\["关系", 44/);
});

test("R1.0 可达页面白名单不包含后续版本模块", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const scope = page.match(/const r1StepIds = new Set\(\[[\s\S]*?\]\);/)?.[0] ?? "";
  for (const id of ["PROFILE-01", "PROFILE-11", "GIFT-01", "HOME-01", "DAILY-03", "MY-01", "MY-03", "MY-09", "MY-16"]) {
    assert.match(scope, new RegExp(`"${id}"`));
  }
  assert.match(scope, /PREVIEW-READ/);
  assert.match(scope, /PREVIEW-GROWTH/);
  assert.match(scope, /PREVIEW-RELATIONSHIP/);
  assert.doesNotMatch(scope.replaceAll("PREVIEW-READ", "").replaceAll("PREVIEW-GROWTH", "").replaceAll("PREVIEW-RELATIONSHIP", ""), /READ-|GRW-|REL-|LIFE-|PER-|SHOP-|GOODS-|ORDER-/);
});

test("R1.0 我的页面不展示后续版本入口", async () => {
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
});

test("真实 API 客户端使用同源接口、Cookie Session 与内存 Access Token", async () => {
  const client = await readFile(new URL("../src/api/client.ts", import.meta.url), "utf8");
  assert.match(client, /const API_BASE = "\/api\/v1"/);
  assert.match(client, /credentials: "include"/);
  assert.match(client, /private accessToken: string \| null = null/);
  assert.match(client, /Idempotency-Key/);
  assert.match(client, /\/auth\/sessions\/refresh/);
  assert.match(client, /\/auth\/sessions\/current/);
  assert.doesNotMatch(client, /localStorage\.setItem\([^\n]*(access|token)/i);
});

test("R1 核心页面调用真实后端能力", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const call of ["api.sendSms", "api.createSession", "api.logout", "api.searchLocations", "api.previewProfile", "api.confirmProfile", "api.claimRegistrationReward", "api.createTodayInsight", "api.generationTask", "api.createProfile", "api.previewOtherProfile", "api.confirmOtherProfile", "api.deleteProfile"]) {
    assert.match(page, new RegExp(call.replace(".", "\\.")));
  }
  assert.doesNotMatch(page, /验证码已发送，原型中/);
  assert.doesNotMatch(page, /原型中直接查看结果/);
});
