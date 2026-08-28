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
  safeReturnPath,
  withReturnPath,
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
  assert.equal(
    dailyReportPath("2026-08-23", "growth-records"),
    "/daily/report?date=2026-08-23&from=growth-records",
  );
  assert.equal(dailyReportReturnPath("growth-records"), ROUTES.myGrowthRecords);
});

test("R1.1 返回来源只接受业务白名单并可随链接传递", () => {
  assert.equal(safeReturnPath("/services", ROUTES.my), ROUTES.services);
  assert.equal(safeReturnPath("/my/benefits", ROUTES.my), ROUTES.myBenefits);
  assert.equal(safeReturnPath("https://evil.example", ROUTES.my), ROUTES.my);
  assert.equal(safeReturnPath("//evil.example", ROUTES.my), ROUTES.my);
  assert.equal(safeReturnPath("/services?product=bad", ROUTES.my), ROUTES.my);
  assert.equal(
    withReturnPath("/services/membership?plan=calm", ROUTES.services),
    "/services/membership?plan=calm&from=%2Fservices",
  );
});

test("R1.1 商业页面返回来源不再固定跳回我的", async () => {
  const commerce = await readFile(
    new URL("../src/features/commerce/CommerceScreens.tsx", import.meta.url),
    "utf8",
  );
  assert.match(commerce, /MembershipPlansScreen\(\).*safeReturnPath\(q\.get\("from"\),ROUTES\.services\)/s);
  assert.match(commerce, /Header title="会员计划" back=\{\(\)=>r\.push\(origin\)\}/);
  assert.match(commerce, /withReturnPath\(ROUTES\.serviceMembership,ROUTES\.services\)/);
  assert.match(commerce, /withReturnPath\(ROUTES\.myBenefits,ROUTES\.services\)/);
  assert.match(commerce, /Header title="订单详情" back=\{\(\)=>r\.push\(withReturnPath\(ROUTES\.myOrders,origin\)\)\}/);
  assert.match(commerce, /Header title="退款进度" back=\{\(\)=>r\.push\(withReturnPath\(ROUTES\.myOrders,origin\)\)\}/);
});

test("成长记录进入报告后会返回成长记录", async () => {
  const my = await readFile(new URL("../src/features/my/MyScreens.tsx", import.meta.url), "utf8");
  assert.match(my, /dailyReportPath\("2026-08-25","growth-records"\)/);
  assert.match(my, /withReturnPath\("\/readings\/report\?cards=3",ROUTES\.myGrowthRecords\)/);
  assert.match(my, /withReturnPath\("\/readings\/generating\?cards=2",ROUTES\.myGrowthRecords\)/);
});

test("已废弃问事入口重定向到当前正式流程", async () => {
  const files = await Promise.all([
    readFile(new URL("../app/readings/confirm/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/readings/config/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/readings/feedback/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/readings/spread/page.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(files[0], /redirect\("\/readings\/new"\)/);
  assert.match(files[1], /redirect\("\/readings\/payment"\)/);
  assert.match(files[2], /redirect\("\/readings"\)/);
  assert.match(files[3], /redirect\("\/readings\/new"\)/);
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
  assert.match(home, /target==="reading"\)router\.push\(ROUTES\.readings\)/);
  assert.doesNotMatch(home, /step===29|step===43|step===44/);
  assert.match(my, /<MyHome[^>]*navigate=\{navigate\}/);
  assert.doesNotMatch(my, /step===29|step===43|step===44/);
});

test("R1.1 问事首页、输入与历史使用独立真实路由", async () => {
  const [routes, home, readingHome, readingNew, readingHistory] = await Promise.all([
    readFile(new URL("../src/shared/routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/home/HomeScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reading/ReadingHomeScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reading/ReadingNewScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reading/ReadingHistoryScreen.tsx", import.meta.url), "utf8"),
  ]);
  for (const path of ["/readings", "/readings/new", "/readings/history"]) assert.match(routes, new RegExp(`"${path}"`));
  assert.match(home, /router\.push\(ROUTES\.readings\)/);
  for (const source of [readingHome, readingNew, readingHistory]) assert.match(source, /<ProtectedRoute>/);
  assert.doesNotMatch(readingHome + readingNew + readingHistory, /setStep\(|profileSteps|navigate\(\d+/);
});

test("档案库返回与体验额度帮助使用独立真实路由", async () => {
  const [routes, daily, legacy] = await Promise.all([
    readFile(new URL("../src/shared/routes.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/features/daily/DailyScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(routes, /mySupport: "\/my\/support"/);
  assert.match(daily, /router\.push\(ROUTES\.mySupport\)/);
  assert.match(legacy, /onBack=\{\(\) => onNavigateRoute \? onNavigateRoute\("\/my"\)/);
  assert.match(legacy, /onSelf=\{\(\) => onNavigateRoute \? onNavigateRoute\("\/my\/profile"\)/);
});

test("R1.1 问事分类、翻牌布局和支付成功出口符合已确认原型", async () => {
  const [legacy, styles, commerce] = await Promise.all([
    readFile(new URL("../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/legacy/legacy.css", import.meta.url), "utf8"),
    readFile(new URL("../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(legacy, /"个人状态", "其他"/);
  assert.match(legacy, /report-card-gallery reveal-card-gallery/);
  assert.match(styles, /\.card-layout\.reveal-card-gallery\.count-5 figure/);
  const success = commerce.slice(commerce.indexOf('return <Screen code="PAY-08"'), commerce.indexOf("function ResultState"));
  assert.match(success, />查看我的权益 <span>→<\/span>/);
  assert.doesNotMatch(success, /查看本周期权益|去查看今日能量|去开始一次问事|biz-secondary/);
});

test("READ-09 不展示原型分支或权益不足入口", async () => {
  const [legacy, flow] = await Promise.all([
    readFile(new URL("../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reading/ReadingFlowScreen.tsx", import.meta.url), "utf8"),
  ]);
  const payment = legacy.slice(legacy.indexOf("export function ReadingPayment"), legacy.indexOf("export function ReadingShuffle"));
  assert.doesNotMatch(payment, /原型分支|查看权益不足|onInsufficient/);
  assert.doesNotMatch(flow, /<ReadingPayment[^>]*onInsufficient/);
});

test("READ-02 在同页完成问题、牌数与牌位并直接进入 READ-09", async () => {
  const [page, screen, flow] = await Promise.all([
    readFile(new URL("../app/readings/new/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reading/ReadingNewScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reading/ReadingFlowScreen.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(page, /<ReadingNewScreen/);
  assert.match(screen, /这次想用几张牌来看/);
  assert.match(screen, /每张牌分别代表什么/);
  assert.match(screen, /writeFlowDraft\("reading"/);
  assert.match(screen, /router\.push\(`\/readings\/payment\?cards=\$\{cardCount\}`\)/);
  assert.match(flow, /payment: <ReadingPayment.*onBack=\{\(\)=>go\("question"\)\}/);
});

test("READ-01 示例覆盖不同牌数，单张模式不要求定义牌位", async () => {
  const [home, screen] = await Promise.all([
    readFile(new URL("../src/features/reading/ReadingHomeScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reading/ReadingNewScreen.tsx", import.meta.url), "utf8"),
  ]);
  for(const label of ["一张牌","两张牌","多张牌"])assert.match(home,new RegExp(label));
  assert.match(screen, /\{cardCount>1&&<section className="compose-section position-section">/);
  assert.match(screen, /\{cardCount>1&&<p><span>牌位<\/span>/);
  assert.match(screen, /确认问题\{cardCount>1\?"与牌位":""\}/);
});

test("R1.1 抽牌操作页采用通用短屏滚动与固定操作区", async () => {
  const [legacy, styles, layout] = await Promise.all([
    readFile(new URL("../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/reading/reading-responsive.css", import.meta.url), "utf8"),
    readFile(new URL("../app/readings/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(legacy, /draw-page reading-action-page/);
  assert.match(legacy, /immersive-reading reading-action-page/);
  assert.match(legacy, /reading-generating reading-action-page/);
  assert.match(styles, /\.reading-action-page\{[^}]*overflow-y:auto/);
  assert.match(styles, /\.reading-action-page>\.primary\{[^}]*position:sticky;bottom:0/);
  assert.match(styles, /\.reading-home\.root-tab-page\{[^}]*overflow-y:auto/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(layout, /reading-responsive\.css/);
});
