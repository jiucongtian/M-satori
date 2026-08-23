import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("核心业务域均具有独立静态路由入口", async () => {
  for (const path of ["../app/page.tsx","../app/login/page.tsx","../app/consent/page.tsx","../app/home/page.tsx","../app/profile/create/page.tsx","../app/daily/page.tsx","../app/daily/report/page.tsx","../app/my/page.tsx","../app/my/profile/page.tsx","../app/my/seeds/page.tsx","../app/my/reports/page.tsx","../app/my/archive/page.tsx","../app/legal/page.tsx"]) await access(new URL(path, import.meta.url));
});

test("安全 next 仅接受白名单业务路径和合法每日报告日期", async () => {
  const routes = await source("../src/shared/routes.ts");
  assert.match(routes, /value\.startsWith\("\/\/"\)/);
  assert.match(routes, /parsed\.origin !== "https:\/\/fresh\.local"/);
  assert.match(routes, /SENSITIVE_QUERY_KEYS/);
  assert.match(routes, /isIsoDate/);
  assert.doesNotMatch(routes, /phone.*searchParams\.set|birthDate.*searchParams\.set/);
});

test("统一 Session 四态和受保护路由守卫已经接入", async () => {
  const [session, guard, layout] = await Promise.all([source("../src/shared/session.tsx"), source("../src/shared/guards.tsx"), source("../app/layout.tsx")]);
  assert.match(session, /"unknown" \| "anonymous" \| "authenticated" \| "consent-required"/);
  assert.match(session, /clearAllFlowDrafts/);
  assert.match(guard, /router\.replace\(loginPath\(pathname\)\)/);
  assert.match(guard, /router\.replace\(consentPath\(pathname\)\)/);
  assert.match(layout, /<Providers>/);
});

test("受保护路由在业务页面挂载前执行守卫", async () => {
  const pages = [
    "../app/home/page.tsx", "../app/profile/create/page.tsx",
    "../app/daily/page.tsx", "../app/daily/report/page.tsx",
    "../app/my/page.tsx", "../app/my/profile/page.tsx",
    "../app/my/seeds/page.tsx", "../app/my/reports/page.tsx",
    "../app/my/archive/page.tsx",
  ];
  for (const page of pages) {
    assert.match(await source(page), /<ProtectedRoute><[A-Za-z]+Screen\/><\/ProtectedRoute>/, `${page} 必须在入口层守卫业务组件`);
  }
});

test("认证和旧业务适配器保留核心写命令与防重复确认", async () => {
  const page = [await source("../src/features/auth/LoginScreen.tsx"), await source("../src/features/auth/ConsentScreen.tsx"), await source("../src/features/legacy/LegacyProfileFlow.tsx")].join("\n");
  for (const command of ["sendSms","createSession","acceptConsents","previewProfile","confirmProfile","generateProfileFirstLook","claimRegistrationReward","createTodayInsight","createProfile","confirmOtherProfile","deleteProfile"]) assert.match(page,new RegExp(`api\\.${command}\\(`));
  assert.match(page,/confirmingRevisionRef/);
  assert.doesNotMatch(page,/[?&](?:phone|code|birthDate|birthTime)=/);
});
