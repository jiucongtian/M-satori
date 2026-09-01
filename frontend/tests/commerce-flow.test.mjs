import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const screensUrl = new URL("../src/features/commerce/CommerceScreens.tsx", import.meta.url);
const clientUrl = new URL("../src/api/client.ts", import.meta.url);
const contextUrl = new URL("../src/features/commerce/commerceContext.ts", import.meta.url);
const routesUrl = new URL("../src/shared/routes.ts", import.meta.url);
const commerceStylesUrl = new URL("../src/features/commerce/commerce.css", import.meta.url);

test("R1.1 商业页面全部使用真实 API 且不在前端计算价格", async () => {
  const [screens, client] = await Promise.all([readFile(screensUrl, "utf8"), readFile(clientUrl, "utf8")]);
  for (const method of [
    "serviceOfferings",
    "membershipPlans",
    "createCheckoutQuote",
    "createMoneyOrder",
    "createPaymentAttempt",
    "moneyOrder",
    "entitlements",
    "usageRecords",
    "currentMembership",
    "refundQuote",
  ]) assert.match(client, new RegExp(`${method}\\(`));
  assert.match(screens, /api\.createCheckoutQuote/);
  assert.match(screens, /应付金额/);
  assert.doesNotMatch(screens, /获取服务端报价|服务端正在|权益账本|核销预留/);
  assert.doesNotMatch(screens, /price\s*\*|amount\s*\*|seed.*rate|exchangeRate/i);
});

test("商城查询只发送后端允许的展示场景参数", async () => {
  const client = await readFile(clientUrl, "utf8");
  const scope = client.match(/serviceOfferings\(\)[\s\S]*?serviceOffering\(offeringId/)?.[0] ?? "";
  assert.match(scope, /service-offerings\?context=STORE/);
  assert.doesNotMatch(scope, /limit=/);
});

test("订单页兼容历史快照且单条异常数据不会导致整页崩溃", async () => {
  const screens = await readFile(screensUrl, "utf8");
  assert.match(screens, /function orderOffering/);
  assert.match(screens, /snapshot\.name \?\? snapshot\.displayName \?\? "服务订单"/);
  assert.match(screens, /snapshot\.kind/);
  assert.match(screens, /snapshot\.offeringKind/);
  assert.doesNotMatch(screens, /productName\(order\.offeringSnapshot\.name\)/);
});

test("会员、权益和使用记录不向用户暴露英文枚举", async () => {
  const screens = await readFile(screensUrl, "utf8");
  for (const value of ["TERMINATED_BY_UPGRADE", "ACTIVE", "PROMOTION", "COMPENSATION", "MIGRATION", "GRANT", "CARD_READING_INTENT"]) {
    assert.match(screens, new RegExp(`${value}:[^\\n]*[\\u4e00-\\u9fff]`));
  }
  assert.match(screens, /return labels\[value\] \?\? "状态更新中"/);
  assert.doesNotMatch(screens, /<i>\{record\.type\}<\/i>/);
  assert.doesNotMatch(screens, /<small>\{record\.businessContext\.type\}<\/small>/);
});

test("会员页只管理会员计划，服务入口统一回到我的", async () => {
  const screens = await readFile(screensUrl, "utf8");
  const membership = screens.match(/export function MembershipScreen[\s\S]*?function MembershipAction/)?.[0] ?? "";
  assert.match(membership, /会员记录/);
  assert.match(membership, /查看过去的会员计划/);
  assert.doesNotMatch(membership, /会员相关服务|查看我的权益|查看服务订单/);
  assert.match(screens, /function productName/);
});

test("商城优先展示真实服务包，会员入口按使用场景呈现", async () => {
  const screens = await readFile(screensUrl, "utf8");
  const shop = screens.match(/export function ShopScreen[\s\S]*?function OfferingCard/)?.[0] ?? "";
  assert.ok(shop.indexOf("按需选择") < shop.indexOf("月度陪伴"));
  assert.match(shop, /services\.length/);
  assert.match(shop, /fulfilledPurchases/);
  assert.match(screens, /该体验服务每位用户限购一次/);
  assert.match(shop, /服务正在准备中/);
  assert.doesNotMatch(screens, /className="commerce-nav"/);
  assert.match(shop, /fresh-membership-entry/);
});

test("商业页面遵循项目视觉变量、交互热区与小屏适配规则", async () => {
  const styles = await readFile(commerceStylesUrl, "utf8");
  assert.match(styles, /var\(--type-page-title\)/);
  assert.match(styles, /var\(--radius-lg\)/);
  assert.match(styles, /min-height:48px/);
  assert.match(styles, /@media\(max-width:360px\)/);
  assert.match(styles, /prefers-reduced-motion/);
  assert.doesNotMatch(styles, /\.my-commerce-dock|\.commerce-nav/);
});

test("已有会员只能在会员中心续费或升级，商品详情不会产生未登记的换档订单", async () => {
  const screens = await readFile(screensUrl, "utf8");
  assert.match(screens, /api\.currentMembership\(\)/);
  assert.match(screens, /currentRank=\{currentRank\}/);
  assert.match(screens, /续费当前方案/);
  assert.match(screens, /previousSubscriptionId=.*targetPlanVersionId=/s);
  assert.match(screens, /当前不可降级/);
  assert.match(screens, /续费周期在当前周期结束后依次开始/);
});

test("固定核销页只展示系统选择结果且没有来源切换命令", async () => {
  const screens = await readFile(screensUrl, "utf8");
  const scope = screens.match(/export function ReadingPrepareScreen[\s\S]*$/)?.[0] ?? "";
  assert.match(scope, /系统自动选择/);
  assert.match(scope, /无需手动选择/);
  assert.doesNotMatch(scope, /selectSource|selectedSourceId|切换来源/);
});

test("支付前仅在会话内保存 opaque businessContext 并恢复安全业务路径", async () => {
  const context = await readFile(contextUrl, "utf8");
  assert.match(context, /window\.sessionStorage/);
  assert.match(context, /businessContext/);
  assert.match(context, /SAFE_RETURN_PATHS/);
  assert.doesNotMatch(context, /localStorage|question|prompt|reportBody/);
});

test("支付结果明确区分资金成功与权益交付完成", async () => {
  const screens = await readFile(screensUrl, "utf8");
  const scope = screens.match(/export function PaymentResultScreen[\s\S]*?export function BenefitsScreen/)?.[0] ?? "";
  assert.match(scope, /支付成功，权益发放中/);
  assert.match(scope, /权益已经到账/);
  assert.match(scope, /请勿重复购买/);
  assert.match(scope, /返回刚才的问事流程/);
});

test("Fake 支付跳过微信收银台并直接进入服务端支付结果轮询", async () => {
  const [screens, client] = await Promise.all([readFile(screensUrl, "utf8"), readFile(clientUrl, "utf8")]);
  const scope = screens.match(/async function submit\(\)[\s\S]*?if \(!ready\)/)?.[0] ?? "";
  const createAttempt = client.slice(client.indexOf("createPaymentAttempt(orderId"), client.indexOf("paymentAttempt(paymentAttemptId"));
  assert.doesNotMatch(createAttempt, /provider:\s*["']WECHAT_PAY["']/);
  assert.match(createAttempt, /payerTicket/);
  assert.doesNotMatch(createAttempt, /provider\s*:/);
  assert.match(scope, /prepareWechatPaymentPayer/);
  assert.match(scope, /MicroMessenger/);
  assert.match(scope, /payment\.provider === ["']WECHAT_PAY["']/);
  assert.match(scope, /invokeWechatPay\(payment\.clientParameters\)/);
  assert.match(scope, /router\.push\(`\$\{ROUTES\.paymentResult\}/);
  assert.doesNotMatch(scope, /payment\.provider === ["']FAKE["'][\s\S]*invokeWechatPay/);
});

test("商业路由进入保护列表且不允许敏感查询参数", async () => {
  const routes = await readFile(routesUrl, "utf8");
  for (const route of ["shop", "checkout", "paymentResult", "readingPrepare", "myBenefits", "myOrders", "myMembership", "myRefunds"]) {
    assert.match(routes, new RegExp(`ROUTES\\.${route}`));
  }
  assert.match(routes, /SENSITIVE_QUERY_KEYS/);
  assert.match(routes, /"question", "prompt"/);
});

test("商城详情保留来源页面，返回操作不再统一跳到我的", async () => {
  const [screens, routes] = await Promise.all([readFile(screensUrl, "utf8"), readFile(routesUrl, "utf8")]);
  assert.match(screens, /function useCommerceBack\(fallback: AppPath\)/);
  assert.match(screens, /<CommerceFrame title=\{productName\(offering\.name\)\} eyebrow=\{kindLabel\(offering\.kind\)\} backHref=\{ROUTES\.shop\}>/);
  assert.match(screens, /withReturnPath\(membership\?\.activePeriod \? ROUTES\.myMembership : ROUTES\.serviceMembership, ROUTES\.shop\)/);
  assert.match(screens, /withReturnPath\(`\$\{ROUTES\.myOrders\}\?kind=service`, ROUTES\.shop\)/);
  assert.match(routes, /\[ROUTES\.shop\]: new Set\(\["returnTo", "from"\]\)/);
  assert.match(routes, /\[ROUTES\.myOrders\]: new Set\(\["orderId", "kind", "from"\]\)/);
});

test("服务次数记录使用用户能理解的完整句子", async () => {
  const screens = await readFile(screensUrl, "utf8");
  assert.match(screens, /服务次数变化记录/);
  assert.match(screens, /新增可用次数/);
  assert.match(screens, /次数已经退回/);
  assert.match(screens, /因权益变更已结束/);
  assert.doesNotMatch(screens, /其他服务/);
});

test("订单入口按会员与服务归位，我的首页不再展示重复订单按钮", async () => {
  const [screens, styles] = await Promise.all([readFile(screensUrl, "utf8"), readFile(new URL("../src/features/legacy/legacy.css", import.meta.url), "utf8")]);
  assert.match(screens, /查看会员订单/);
  assert.match(screens, /查看已购买的服务/);
  assert.match(screens, /kind === "membership"/);
  assert.match(styles, /\.my-r11-service-center>header>button\{display:none\}/);
});

test("测试构建同时标注 R1.0 核心页面，报告行动与反思采用纵向卡片", async () => {
  const [shell, daily, styles] = await Promise.all([
    readFile(new URL("../src/shared/shell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/daily/DailyScreen.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/features/legacy/legacy.css", import.meta.url), "utf8"),
  ]);
  assert.match(shell, /R1\.0 · HOME-01/);
  assert.match(shell, /R1\.0 · DAILY-03/);
  assert.match(shell, /R1\.0 · AUTH-04/);
  assert.match(daily, /R1\.0 · \$\{pageCode\}/);
  assert.match(styles, /\.report-columns \{ margin-top: 10px; display: grid; grid-template-columns: 1fr/);
});
