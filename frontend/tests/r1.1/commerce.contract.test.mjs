import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PROTECTED_PATHS, ROUTES } from "../../src/shared/routes.ts";

test("R11-PAY-001：会员、服务包、收银台和订单均为受保护的真实路由", () => {
  for (const path of [
    ROUTES.services,
    ROUTES.serviceMembership,
    ROUTES.serviceMembershipDetail,
    ROUTES.serviceEnergyPack,
    ROUTES.serviceReadingPack,
    ROUTES.checkout,
    ROUTES.checkoutPay,
    ROUTES.checkoutResult,
    ROUTES.myBenefits,
    ROUTES.myOrders,
    ROUTES.myOrderDemo,
    ROUTES.refundNew,
    ROUTES.refundStatus,
  ]) assert.equal(PROTECTED_PATHS.has(path), true, `${path} 必须受登录保护`);
});

test("R11-PAY-002：会员方案由目录定义并明确记录权益周期边界", async () => {
  const [page, catalog] = await Promise.all([
    readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../backend/packages/modules/src/catalog/domain/seed-data.ts", import.meta.url), "utf8"),
  ]);
  for (const plan of ["微光计划", "清和计划", "自在计划"]) assert.match(catalog, new RegExp(plan));
  assert.match(catalog, /periodDays: 30/);
  assert.match(page, /未使用次数到期不结转/);
  assert.match(page, /会员与服务包分别记录/);
  assert.match(page, /续费当前方案/);
  assert.match(page, /续费周期在当前周期结束后依次开始/);
  assert.match(page, /当前不可降级/);
});

test("R11-PAY-003：支付提交具有进行中锁且 Fake 支付不会调用微信收银台", async () => {
  const page = await readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  assert.match(page, /if \(!quote \|\| busy\) return/);
  assert.match(page, /disabled=\{busy\}/);
  assert.match(page, /payment\.provider === "WECHAT_PAY"/);
  assert.match(page, /invokeWechatPay\(payment\.clientParameters\)/);
  assert.match(page, /请勿重复支付/);
});

test("R11-PAY-004：商品价格、资格与支付结果不由前端自行确认", async () => {
  const page = await readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  assert.match(page, /价格、资格与限购均由服务端确认/);
  assert.match(page, /服务端正在确认价格与购买资格/);
  assert.match(page, /服务端报价/);
  assert.match(page, /api\.createMoneyOrder\(quote\.quoteId\)/);
});

test("R11-PAY-005：支付处理中、未完成与权益发放异常都有恢复出口", async () => {
  const page = await readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  for (const copy of ["正在确认支付结果", "本次支付未完成", "支付成功，权益发放中", "查看订单详情"]) {
    assert.match(page, new RegExp(copy));
  }
  assert.match(page, /order\.status === "FULFILLMENT_FAILED"/);
});

test("R11-PAY-006：普通退款由服务端校验并冻结权益，会员升级旧方案不退款", async () => {
  const [page, refund] = await Promise.all([
    readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../../backend/packages/modules/src/refund/application/index.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /检查退款资格/);
  assert.match(page, /服务端报价/);
  assert.match(page, /会员升级原方案剩余权益不属于退款范围/);
  assert.match(refund, /freezeBySource\(orderId, 'ORDINARY_REFUND_REQUESTED'\)/);
  assert.match(refund, /MEMBERSHIP_REFUND_NOT_SUPPORTED/);
});

test("R11-GOODS-001：智慧种子仅作为活动资格，不承担现金抵扣或交易功能", async () => {
  const page = await readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  assert.match(page, /智慧种子只用于活动资格/);
  assert.match(page, /不折算金额/);
  assert.match(page, /不与人民币组合支付/);
  assert.match(page, /种子仅用于资格预留/);
});

test("R11-SHARE-001：分享内容默认排除敏感资料与完整报告", async () => {
  const page = await readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  assert.match(page, /分享卡不包含出生资料与完整报告内容/);
  assert.match(page, /不包含出生日期、地点、卡牌干支与完整报告/);
  assert.match(page, /默认保护你的原始问题/);
});
