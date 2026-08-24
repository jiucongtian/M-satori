import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  authenticatedEntryPath,
  consentCompletionPath,
  dailyReportPath,
  dailyReportReturnPath,
  ROUTES,
  safeNextPath,
} from "../src/shared/routes.ts";

test("认证后入口只由后端 nextAction 决定", () => {
  assert.equal(authenticatedEntryPath("ACCEPT_CONSENTS"), ROUTES.consent);
  for (const action of ["CREATE_PROFILE", "CONFIRM_PROFILE", "CLAIM_REGISTRATION_REWARD"]) {
    assert.equal(authenticatedEntryPath(action), ROUTES.profileCreate);
  }
  for (const action of ["CREATE_TODAY_DAILY_INSIGHT", "VIEW_HOME"]) {
    assert.equal(authenticatedEntryPath(action), ROUTES.home);
  }
});

test("来源页只用于已完成账号准备后的协议恢复", () => {
  assert.equal(consentCompletionPath("VIEW_HOME", "/my"), ROUTES.my);
  assert.equal(consentCompletionPath("CREATE_PROFILE", "/my"), ROUTES.profileCreate);
  assert.equal(consentCompletionPath("CLAIM_REGISTRATION_REWARD", "/my"), ROUTES.profileCreate);
});

test("每日报告保留安全来源并返回对应业务域", () => {
  assert.equal(dailyReportPath("2026-08-23"), "/daily/report?date=2026-08-23");
  assert.equal(
    dailyReportPath("2026-08-23", "my-reports"),
    "/daily/report?date=2026-08-23&from=my-reports",
  );
  assert.equal(dailyReportReturnPath(null), ROUTES.home);
  assert.equal(dailyReportReturnPath("unknown"), ROUTES.home);
  assert.equal(dailyReportReturnPath("my-reports"), ROUTES.myReports);
});

test("报告来源参数经过 next 白名单校验", () => {
  const valid = "/daily/report?date=2026-08-23&from=my-reports";
  assert.equal(safeNextPath(valid), valid);
  assert.equal(safeNextPath("/daily/report?date=2026-08-23&from=https://evil.example"), ROUTES.home);
});

test("真实路由返回目标不会指向会自动恢复的每日入口", async () => {
  const [report, home, my, daily] = await Promise.all([
    readFile(new URL("../src/features/daily/DailyReportScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/home/HomeScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/my/MyScreens.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/daily/DailyScreen.tsx", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(report, /onBack=\{\(\)=>router\.(?:push|replace)\(ROUTES\.daily\)\}/);
  assert.match(report, /onBack=\{\(\)=>router\.replace\(returnPath\)\}/);
  assert.match(home, /dailyReportPath\(home\.dailyInsight\.localDate\)/);
  assert.match(my, /dailyReportPath\(home\.dailyInsight\.localDate,"my-reports"\)/);
  assert.match(daily, /router\.replace\(dailyReportPath\(/);
});

test("首页与我的底部导航使用具名目标而非易漂移的数字步骤", async () => {
  const [legacy, home, my] = await Promise.all([
    readFile(new URL("../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/home/HomeScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/my/MyScreens.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(legacy, /export type HomeNavTarget = "today" \| "reading" \| "relationship" \| "growth" \| "my"/);
  assert.match(legacy, /function HomeMainNav/);
  assert.match(legacy, /navigate\("today"\)/);
  assert.match(home, /target==="reading"\?"问事":target==="relationship"\?"关系":"成长"/);
  assert.doesNotMatch(home, /step===29|step===43|step===44/);
  assert.match(my, /<MyHome[^>]*navigate=\{navigate\}/);
  assert.doesNotMatch(my, /step===29|step===43|step===44/);
});
