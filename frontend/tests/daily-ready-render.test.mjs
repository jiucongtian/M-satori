import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/features/daily/DailyScreen.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;

function renderState(state) {
  const exports = {};
  const passthrough = ({ children }) => React.createElement("div", null, children);
  const deps = {
    react: { ...React, useReducer: () => [{ state }, () => {}], useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect: () => {} },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { useRouter: () => ({ replace() {}, push() {} }) },
    "@/src/shared/guards": { ProtectedRoute: passthrough },
    "@/src/shared/shell": { RouteFrame: passthrough },
    "@/src/shared/ui": { PageDebugLabel: () => null },
  };
  vm.runInNewContext(compiled, { exports, require: name => deps[name] ?? {} });
  return renderToStaticMarkup(React.createElement(exports.default));
}

test("成功到报告跳转之间渲染成功过渡，不闪现失败提示", () => {
  const html = renderState("ready");
  assert.match(html, /生成完成，正在打开报告/);
  assert.doesNotMatch(html, /今日指引暂时没有完成|返回重试|role="alert"/);
});

test("只有失败状态显示失败提示，其他过渡状态不误报失败", () => {
  assert.match(renderState("failed"), /今日指引暂时没有完成/);
  for (const state of ["loading", "confirming-cost", "unavailable"]) {
    assert.doesNotMatch(renderState(state), /今日指引暂时没有完成|role="alert"/);
  }
});
