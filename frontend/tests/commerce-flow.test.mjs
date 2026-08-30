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
  assert.match(screens, /服务端报价/);
  assert.doesNotMatch(screens, /price\s*\*|amount\s*\*|seed.*rate|exchangeRate/i);
});

test("商城优先展示真实服务包，会员与订单入口按使用场景呈现", async () => {
  const screens = await readFile(screensUrl, "utf8");
  const shop = screens.match(/export function ShopScreen[\s\S]*?function OfferingCard/)?.[0] ?? "";
  assert.ok(shop.indexOf("按需选择") < shop.indexOf("月度陪伴"));
  assert.match(shop, /services\.length/);
  assert.match(shop, /服务正在准备中/);
  assert.doesNotMatch(screens, /className="commerce-nav"/);
  assert.match(screens, /aria-label="会员相关服务"/);
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
  assert.match(scope, /页面不提供切换入口/);
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
  assert.match(createAttempt, /JSON\.stringify\(\{\}\)/);
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
