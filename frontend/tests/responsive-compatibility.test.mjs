import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const shellUrl = new URL("../src/shared/responsive-shell.css", import.meta.url);
const globalsUrl = new URL("../app/globals.css", import.meta.url);
const legacyUrl = new URL("../src/features/legacy/legacy.css", import.meta.url);

test("根页面共享单一视口、滚动区与安全区底栏契约", async () => {
  const [shell, globals, legacy] = await Promise.all([
    readFile(shellUrl, "utf8"),
    readFile(globalsUrl, "utf8"),
    readFile(legacyUrl, "utf8"),
  ]);
  assert.match(globals, /@import "\.\.\/src\/shared\/responsive-shell\.css"/);
  assert.match(shell, /--app-viewport-height:100dvh/);
  assert.match(shell, /@supports not \(height:100dvh\)/);
  assert.match(shell, /grid-template-rows:minmax\(0,1fr\) var\(--app-tabbar-height\)/);
  assert.match(shell, /overflow-y:auto/);
  assert.match(shell, /env\(safe-area-inset-bottom,0px\)/);
  assert.match(shell, /-webkit-overflow-scrolling:touch/);
  assert.doesNotMatch(legacy, /grid-template-rows:minmax\(0,1fr\) var\(--app-tabbar-height\)/);
});

test("Mate X7 外屏、内屏和横屏都有明确布局策略", async () => {
  const shell = await readFile(shellUrl, "utf8");
  assert.match(shell, /@media\(max-width:390px\) and \(max-height:840px\)/);
  assert.match(shell, /@media\(min-width:521px\) and \(max-height:860px\)/);
  assert.match(shell, /@media\(orientation:landscape\) and \(max-height:560px\)/);
  assert.match(shell, /\.home-energy-card \.home-growth-scene\{min-height:88px\}/);
  assert.match(shell, /\.home-energy-card \.home-guidance-link\{margin-top:0\}/);
});

test("兼容性调整不通过动态测高或重挂载底部栏实现", async () => {
  const shell = await readFile(shellUrl, "utf8");
  assert.doesNotMatch(shell, /position:fixed/);
  assert.doesNotMatch(shell, /--measured|javascript|resizeobserver/i);
  assert.match(shell, /transform:translateZ\(0\)/);
  assert.match(shell, /prefers-reduced-motion:reduce/);
});
