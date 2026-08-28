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

test("R11-PAY-002：会员计划明确不自动续费，并且记录权益边界", async () => {
  const page = await readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  for (const copy of ["微光计划", "清和计划", "自在计划", "不自动续费", "已有服务包不会被覆盖"]) {
    assert.match(page, new RegExp(copy));
  }
});

test("R11-PAY-003：支付前必须确认协议，支付异常禁止重复购买", async () => {
  const page = await readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  assert.match(page, /disabled=\{!checked\}/);
  assert.match(page, /服务购买协议/);
  assert.match(page, /支付结果以服务端确认为准/);
  assert.match(page, /请不要重复支付/);
  assert.match(page, /付款成功，权益发放处理中/);
});

test("R11-PAY-004：商品价格、资格与支付结果不由前端自行确认", async () => {
  const page = await readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  assert.match(page, /提交订单前会再次校验资格/);
  assert.match(page, /支付结果以服务端确认为准/);
  assert.match(page, /实付合计/);
});

test("R11-PAY-005：支付处理中、未完成与权益发放异常都有恢复出口", async () => {
  const page = await readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  for (const copy of ["支付结果确认中", "本次支付没有完成", "付款成功，权益发放处理中", "查看订单处理进度"]) {
    assert.match(page, new RegExp(copy));
  }
});

test("R11-PAY-006：退款会先冻结权益并展示审核与原路退款过程", async () => {
  const page = await readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  assert.match(page, /剩余8次问事权益将立即冻结/);
  assert.match(page, /审核通过后回收未使用权益，实际退款原路返回/);
  assert.match(page, /退款申请审核中/);
});

test("R11-GOODS-001：智慧种子仅作为活动资格，不承担现金抵扣或交易功能", async () => {
  const page = await readFile(new URL("../../src/features/commerce/CommerceScreens.tsx", import.meta.url), "utf8");
  assert.match(page, /智慧种子活动资格/);
  assert.match(page, /不折抵现金/);
  assert.match(page, /不可购买、交易、提现或兑换人民币/);
});

test("R11-SHARE-001：分享内容默认排除敏感资料与完整报告", async () => {
  const page = await readFile(new URL("../../src/features/legacy/LegacyProfileFlow.tsx", import.meta.url), "utf8");
  assert.match(page, /分享卡不包含出生资料与完整报告内容/);
  assert.match(page, /不包含出生日期、地点、卡牌干支与完整报告/);
  assert.match(page, /默认保护你的原始问题/);
});
