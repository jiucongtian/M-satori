import { expect, test } from "@playwright/test";
import {installApiFixture} from './fixture';

test.beforeEach(async ({ page }) => {
  await installApiFixture(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "工作台" })).toBeVisible();
  await page.waitForTimeout(400);
});

test("@smoke ADMIN-SMOKE-001 九个核心模块均可进入", async ({ page }) => {
  for (const name of ["数据分析", "用户中心", "权益中心", "商品中心", "交易中心", "审核中心", "操作审计", "系统管理", "工作台"]) {
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.locator(".admin-topbar h1")).toHaveText(name);
  }
});

test("@smoke ADMIN-DATA-001 数据分析使用服务端数据并支持核心视图切换", async ({ page }) => {
  await page.getByRole("button", { name: /数据分析/ }).click();
  await expect(page.getByText("匿名访问用户")).toBeVisible();
  await expect(page.getByText("1,842", { exact: true })).toBeVisible();
  for (const [tab, content] of [["转化漏斗", "注册漏斗"], ["页面与功能", "页面与功能表现"], ["商品与交易", "商品与交易路径"], ["体验与异常", "异常与阻断排行"], ["数据健康", "数据权限与统计边界"]]) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    await expect(page.getByText(content, { exact: true })).toBeVisible();
  }
});

test("@smoke ADMIN-USER-001 查询用户支持有结果与无结果", async ({ page }) => {
  await page.getByRole("button", { name: /用户中心/ }).click();
  const input = page.getByPlaceholder("输入手机号或账户编号");
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
  await expect(page.getByText("这里不会使用示例数据填充。")).toBeVisible();
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

test("@smoke ADMIN-ORDER-001 订单详情展示真实支付与到账状态", async ({ page }) => {
  await page.getByRole("button", { name: /交易中心/ }).click();
  await page.getByRole("button", { name: /诊断/ }).first().click();
  await expect(page.locator(".order-drawer").getByRole("heading", { name: "订单详情" })).toBeVisible();
  await expect(page.locator(".order-drawer")).toContainText("到账异常");
});

test("ADMIN-PERMISSION-001 一个账号可有多角色且高风险权限受限", async ({ page }) => {
  await page.getByRole("button", { name: /系统管理/ }).click();
  await page.getByRole("button", { name: "权限矩阵" }).click();
  await expect(page.getByText(/最终权限取有效角色并集/)).toBeVisible();
  await expect(page.getByText("正式发布", { exact: true })).toBeVisible();
});
