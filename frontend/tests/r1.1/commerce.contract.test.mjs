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

test.todo("R11-PAY-004：新客资格、价格和支付参数以服务端校验为准");
test.todo("R11-PAY-005：支付回调、订单、权益发放和余额流水保持幂等一致");
test.todo("R11-PAY-006：退款提交立即冻结未使用权益，并正确进入审核与原路退款");
test.todo("R11-GOODS-001：智慧种子购买、商品兑换和原任务返回保持上下文");
test.todo("R11-SHARE-001：问事、日签和报告分享默认排除敏感信息");
