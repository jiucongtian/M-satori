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

test("服务端渲染 R1.0 欢迎页", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /<title>身心游 · Satori<\/title>/);
  assert.match(html, /R1\.0 · AUTH-01/);
  assert.match(html, /生命智慧档案/);
  assert.match(html, /开始了解自己/);
  assert.doesNotMatch(html, /codex-preview|loading skeleton/i);
});

test("R1.0 登录流程包含版本标签与安全约束", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /R1\.0 · AUTH-02/);
  assert.match(page, /R1\.0 · AUTH-03/);
  assert.match(page, /用户协议/);
  assert.match(page, /隐私政策/);
  assert.match(page, /AI 内容说明/);
  assert.match(page, /\^1\\d\{10\}\$/);
  assert.match(page, /maxLength=\{6\}/);
});

test("候选接口被明确标记为待后端支持", async () => {
  const support = await readFile(new URL("../src/api/contracts/support.ts", import.meta.url), "utf8");
  assert.match(support, /CONTRACT_PROPOSED/);
  assert.match(support, /profileLibrary/);
  assert.match(support, /registrationReward/);
  assert.match(support, /wisdomSeeds/);
});
