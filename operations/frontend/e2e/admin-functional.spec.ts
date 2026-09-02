import { expect, test } from "@playwright/test";
import {installApiFixture} from './fixture';

test.beforeEach(async ({ page }) => {
  await installApiFixture(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.waitForTimeout(400);
});

test("@smoke ADMIN-SMOKE-001 八个核心模块均可进入", async ({ page }) => {
  for (const name of ["用户中心", "权益中心", "商品中心", "交易中心", "审核中心", "操作审计", "系统管理", "工作台"]) {
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.locator(".admin-topbar h1")).toHaveText(name);
  }
});

test("@smoke ADMIN-USER-001 查询用户支持有结果与无结果", async ({ page }) => {
  await page.getByRole("button", { name: /用户中心/ }).click();
  const input = page.getByPlaceholder("输入手机号、用户编号或昵称");
  await input.fill("131");
  await page.getByRole("button", { name: "查询用户" }).click();
  await expect(page.getByText("131****1314", { exact: true })).toBeVisible();
  await input.fill("不存在的用户");
  await page.getByRole("button", { name: "查询用户" }).click();
  await expect(page.getByText("没有找到匹配用户")).toBeVisible();
});

test("@smoke ADMIN-BENEFIT-001 权益中心只展示接口返回记录", async ({ page }) => {
  await page.getByRole("button", { name: /权益中心/ }).click();
  await expect(page.getByText("暂无记录")).toBeVisible();
  await page.getByRole("button", { name: /人工发放/ }).click();
  await page.getByLabel("用户手机号").fill("13900002016");
  await page.getByLabel("发放类型").selectOption("会员计划");
  await expect(page.locator("label").filter({ hasText: /^会员计划/ }).locator("select")).toBeVisible();
  await expect(page.getByText(/该手机号尚未注册/)).toBeVisible();
  await page.getByRole("button", { name: "确认并提交审核" }).click();
});

test("@smoke ADMIN-PRODUCT-001 三类商品可筛选、配置和预览", async ({ page }) => {
  await page.getByRole("button", { name: "品 商品中心" }).click();
  for (const category of ["单次产品", "服务包", "会员计划"]) {
    await page.getByRole("button", { name: new RegExp(`^${category}`) }).click();
    await expect(page.getByRole("heading", { name: new RegExp(`${category} · 商品与版本`) })).toBeVisible();
    await page.getByRole("button", { name: /查看并配置/ }).first().click();
    await expect(page.getByRole("button", { name: "用户端预览" })).toBeVisible();
    await page.getByRole("button", { name: "用户端预览" }).click();
    await expect(page.getByRole("button", { name: "确认购买" })).toBeVisible();
    await page.getByRole("button", { name: "返回配置" }).click();
    await page.getByRole("button", { name: /返回商品列表/ }).click();
  }
});

test("@smoke ADMIN-ORDER-001 异常订单支持诊断且仅异常单可补发", async ({ page }) => {
  await page.getByRole("button", { name: /交易中心/ }).click();
  await page.getByRole("button", { name: /诊断/ }).first().click();
  await expect(page.locator(".order-drawer").getByRole("heading", { name: "订单诊断" })).toBeVisible();
  await expect(page.getByText(/支付已成功，权益尚未到账/)).toBeVisible();
  await expect(page.getByRole("button", { name: "安全补发" })).toBeEnabled();
});

test("ADMIN-PERMISSION-001 一个账号可有多角色且高风险权限受限", async ({ page }) => {
  await page.getByRole("button", { name: /系统管理/ }).click();
  await page.getByRole("button", { name: "权限矩阵" }).click();
  await expect(page.getByText(/最终权限＝所有有效角色权限并集/)).toBeVisible();
  await expect(page.getByText("正式发布", { exact: true })).toBeVisible();
});
