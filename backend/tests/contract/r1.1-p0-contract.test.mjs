import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const contract = JSON.parse(await readFile(new URL("../../openapi/r1.1-p0-contract.json", import.meta.url), "utf8"));
const scenarios = JSON.parse(await readFile(new URL("./fixtures/r1.1-p0-scenarios.json", import.meta.url), "utf8"));

test("R1.1 P0：问事与交易契约具有完整的任务、支付和退款入口", () => {
  const required = [
    ["/v1/readings", "post"],
    ["/v1/readings/{readingId}", "get"],
    ["/v1/readings/{readingId}/draw", "post"],
    ["/v1/readings/{readingId}/generate", "post"],
    ["/v1/readings/{readingId}/retry", "post"],
    ["/v1/checkout/orders", "post"],
    ["/v1/payments/wechat/callback", "post"],
    ["/v1/orders/{orderId}", "get"],
    ["/v1/refunds", "post"],
  ];
  for (const [path, method] of required) assert.ok(contract.paths[path]?.[method], `${method.toUpperCase()} ${path} 不得缺失`);
});

test("R1.1 P0：所有会产生写入的核心接口要求幂等键", () => {
  const writePaths = ["/v1/readings", "/v1/readings/{readingId}/draw", "/v1/readings/{readingId}/generate", "/v1/readings/{readingId}/retry", "/v1/checkout/orders", "/v1/payments/wechat/callback", "/v1/refunds"];
  for (const path of writePaths) assert.equal(contract.paths[path].post["x-idempotency-required"], true, `${path} 必须支持幂等`);
});

test("R1.1 P0：状态机覆盖报告失败恢复、支付发放中和退款冻结", () => {
  assert.deepEqual(contract.components.schemas.ReadingStatus.enum, ["DRAFT", "CARDS_DRAWN", "GENERATING", "COMPLETED", "FAILED", "REFUNDED"]);
  for (const status of ["PAYMENT_PROCESSING", "DELIVERY_PENDING", "REFUND_PENDING", "REFUNDED"]) {
    assert.ok(contract.components.schemas.OrderStatus.enum.includes(status));
  }
});

test("R1.1 P0：Mock 场景同时覆盖正向与负向恢复路径", () => {
  assert.equal(scenarios.length, 8);
  assert.ok(scenarios.some((item) => item.kind === "positive"));
  assert.ok(scenarios.filter((item) => item.kind === "negative").length >= 5);
  for (const item of scenarios) {
    assert.match(item.id, /^R11-(CORE|PAY|REFUND)-\d{3}$/);
    assert.ok(item.given && item.when && item.then.length >= 2, `${item.id} 必须完整描述 Given/When/Then`);
  }
});
