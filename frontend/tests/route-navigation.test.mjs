import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  dailyReportPath,
  dailyReportReturnPath,
  ROUTES,
  safeNextPath,
} from "../src/shared/routes.ts";

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
