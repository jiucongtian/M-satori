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

test("正式工程与原型使用同源样式", async () => {
  const [formalCss, prototypeCss] = await Promise.all([
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../../../h5-prototype/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.equal(formalCss, prototypeCss);
});

test("正式页面只允许 R1.0 标签区别于原型源代码", async () => {
  const [formalPage, prototypePage] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../h5-prototype/app/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.equal(formalPage, prototypePage.replaceAll("R1 ·", "R1.0 ·"));
});

test("待后端能力具有明确候选契约", async () => {
  const support = await readFile(new URL("../src/api/contracts/support.ts", import.meta.url), "utf8");
  assert.match(support, /CONTRACT_PROPOSED/);
  assert.match(support, /profileLibrary/);
  assert.match(support, /registrationReward/);
  assert.match(support, /wisdomSeeds/);
});
